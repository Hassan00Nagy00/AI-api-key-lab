import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

// CRC32 Lookup Table for PNG Chunk Checksums
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rawScanlines, rowStart + 1);
  }

  const compressed = zlib.deflateSync(rawScanlines, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v: number, min = 0, max = 1): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function sdRoundedBox(px: number, py: number, cx: number, cy: number, halfW: number, halfH: number, r: number): number {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - r;
}

function blendPixel(
  dst: [number, number, number, number],
  sr: number,
  sg: number,
  sb: number,
  sa: number
): [number, number, number, number] {
  if (sa <= 0) return dst;
  const invA = 1 - sa;
  const outA = sa + dst[3] * invA;
  if (outA <= 0) return [0, 0, 0, 0];
  const outR = (sr * sa + dst[0] * dst[3] * invA) / outA;
  const outG = (sg * sa + dst[1] * dst[3] * invA) / outA;
  const outB = (sb * sa + dst[2] * dst[3] * invA) / outA;
  return [outR, outG, outB, outA];
}

/**
 * Evaluate the 1024x1024 normalized coordinate space at (x, y) in [0, 1024]
 */
function sampleAppIcon(x: number, y: number, pixelScale: number): [number, number, number, number] {
  const aa = Math.max(1.5, pixelScale * 1.25);
  let color: [number, number, number, number] = [0, 0, 0, 0];

  // 1. Soft Outer Drop Shadow under Squircle
  const shadowDist = sdRoundedBox(x, y - 16, 512, 512, 412, 412, 185);
  if (shadowDist < 42) {
    const shadowAlpha = (1 - smoothstep(-10, 42, shadowDist)) * 0.48;
    color = blendPixel(color, 0, 0, 0, shadowAlpha);
  }

  // 2. Main 824x824 Squircle Body (centered at 512, 512, radius 185)
  const sqDist = sdRoundedBox(x, y, 512, 512, 412, 412, 185);
  if (sqDist < aa) {
    const sqAlpha = 1 - smoothstep(-aa, aa, sqDist);
    const diagT = clamp(((x - 100) + (y - 100)) / 1648, 0, 1);
    let bgR = 15 * (1 - diagT) + 9 * diagT;
    let bgG = 23 * (1 - diagT) + 13 * diagT;
    let bgB = 42 * (1 - diagT) + 22 * diagT;

    // Radial core glow around (512, 492)
    const glowDist = Math.hypot(x - 512, y - 492);
    if (glowDist < 340) {
      const glowT = Math.pow(1 - glowDist / 340, 1.8) * 0.32;
      bgR = bgR * (1 - glowT) + 37 * glowT;
      bgG = bgG * (1 - glowT) + 99 * glowT;
      bgB = bgB * (1 - glowT) + 235 * glowT;
    }

    color = blendPixel(color, bgR, bgG, bgB, sqAlpha);

    // Subtle Inner Rim Border (stroke width 6 around sqDist = -3)
    const rimDist = Math.abs(sqDist + 4) - 3;
    if (rimDist < aa) {
      const rimAlpha = (1 - smoothstep(-aa, aa, rimDist)) * 0.45 * sqAlpha;
      const rimT = clamp((y - 100) / 824, 0, 1);
      const rR = 56 * (1 - rimT) + 99 * rimT;
      const rG = 189 * (1 - rimT) + 102 * rimT;
      const rB = 248 * (1 - rimT) + 241 * rimT;
      color = blendPixel(color, rR, rG, rB, rimAlpha);
    }
  } else {
    return color;
  }

  // 3. Subtle Hexagonal Shield Ring
  const hexVerts: [number, number][] = [
    [512, 224],
    [736, 353],
    [736, 611],
    [512, 740],
    [288, 611],
    [288, 353],
  ];
  let minHexEdge = Infinity;
  for (let i = 0; i < hexVerts.length; i++) {
    const [x1, y1] = hexVerts[i];
    const [x2, y2] = hexVerts[(i + 1) % hexVerts.length];
    minHexEdge = Math.min(minHexEdge, distToSegment(x, y, x1, y1, x2, y2));
  }
  const hexStrokeDist = minHexEdge - 3.5;
  if (hexStrokeDist < aa) {
    const hexAlpha = (1 - smoothstep(-aa, aa, hexStrokeDist)) * 0.28;
    color = blendPixel(color, 56, 189, 248, hexAlpha);
  }

  // 4. Connection Traces & Nodes
  const trace1 = distToSegment(x, y, 392, 362, 318, 296) - 3.5;
  const trace2 = distToSegment(x, y, 392, 602, 318, 668) - 3.5;
  const trace3 = distToSegment(x, y, 650, 376, 718, 308) - 3.5;
  const minTrace = Math.min(trace1, trace2, trace3);
  if (minTrace < aa) {
    const trAlpha = (1 - smoothstep(-aa, aa, minTrace)) * 0.42;
    color = blendPixel(color, 56, 189, 248, trAlpha);
  }

  for (const [nx, ny] of [[318, 296], [318, 668]]) {
    const nd = Math.hypot(x - nx, y - ny);
    if (nd < 18 + aa) {
      const fillA = 1 - smoothstep(14 - aa, 14 + aa, nd);
      color = blendPixel(color, 15, 23, 42, fillA);
      const ringD = Math.abs(nd - 15) - 3.5;
      if (ringD < aa) {
        const ringA = 1 - smoothstep(-aa, aa, ringD);
        color = blendPixel(color, 56, 189, 248, ringA);
      }
    }
  }

  // 5. Key Symbol Distance Field (Bow + Core + Shaft + 2 Cryptographic Teeth)
  const bowRingDist = Math.abs(Math.hypot(x - 392, y - 482) - 116) - 22;
  const bowCoreDist = Math.hypot(x - 392, y - 482) - 30;
  const shaftDist = distToSegment(x, y, 498, 482, 736, 482) - 22;
  const tooth1Dist = distToSegment(x, y, 618, 482, 618, 576) - 20;
  const tooth2Dist = distToSegment(x, y, 704, 482, 704, 606) - 20;
  const keyDist = Math.min(bowRingDist, bowCoreDist, shaftDist, tooth1Dist, tooth2Dist);

  // Key drop shadow
  const bowRingShadow = Math.abs(Math.hypot(x - 392, y - 492) - 116) - 22;
  const shaftShadow = distToSegment(x, y, 498, 492, 736, 492) - 22;
  const keyShadowDist = Math.min(bowRingShadow, shaftShadow);
  if (keyShadowDist < 16) {
    const ksAlpha = (1 - smoothstep(-4, 16, keyShadowDist)) * 0.4;
    color = blendPixel(color, 0, 0, 0, ksAlpha);
  }

  if (keyDist < aa) {
    const keyAlpha = 1 - smoothstep(-aa, aa, keyDist);
    const kt = clamp((x - 260) / 500, 0, 1);
    // Gradient from Sky (#38BDF8) -> Blue (#3B82F6) -> Indigo (#6366F1)
    let kR: number, kG: number, kB: number;
    if (kt < 0.5) {
      const u = kt * 2;
      kR = 56 * (1 - u) + 59 * u;
      kG = 189 * (1 - u) + 130 * u;
      kB = 248 * (1 - u) + 246 * u;
    } else {
      const u = (kt - 0.5) * 2;
      kR = 59 * (1 - u) + 99 * u;
      kG = 130 * (1 - u) + 102 * u;
      kB = 246 * (1 - u) + 241 * u;
    }
    color = blendPixel(color, kR, kG, kB, keyAlpha);
  }

  // 6. Verified Emerald Node Badge at (718, 308)
  const badgeDist = Math.hypot(x - 718, y - 308) - 46;
  if (badgeDist < aa) {
    const badgeAlpha = 1 - smoothstep(-aa, aa, badgeDist);
    const bt = clamp((y - 262) / 92, 0, 1);
    const bR = 52 * (1 - bt) + 16 * bt;
    const bG = 211 * (1 - bt) + 185 * bt;
    const bB = 153 * (1 - bt) + 129 * bt;
    color = blendPixel(color, bR, bG, bB, badgeAlpha);

    // Checkmark inside badge: (698,308) -> (712,322) -> (740,294)
    const chk1 = distToSegment(x, y, 698, 308, 712, 322) - 6;
    const chk2 = distToSegment(x, y, 712, 322, 740, 294) - 6;
    const chkDist = Math.min(chk1, chk2);
    if (chkDist < aa) {
      const chkAlpha = (1 - smoothstep(-aa, aa, chkDist)) * badgeAlpha;
      color = blendPixel(color, 6, 46, 34, chkAlpha);
    }
  }

  return color;
}

function renderIconSize(size: number): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const pixelScale = 1024 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // 2x2 Supersampling for crisp anti-aliased edges
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;
      for (let sy = 0.25; sy <= 0.75; sy += 0.5) {
        for (let sx = 0.25; sx <= 0.75; sx += 0.5) {
          const normX = ((px + sx) / size) * 1024;
          const normY = ((py + sy) / size) * 1024;
          const [r, g, b, a] = sampleAppIcon(normX, normY, pixelScale);
          rAcc += r * a;
          gAcc += g * a;
          bAcc += b * a;
          aAcc += a;
        }
      }
      const finalA = aAcc / 4;
      const idx = (py * size + px) * 4;
      if (finalA > 0) {
        rgba[idx] = Math.round(clamp(rAcc / aAcc, 0, 255));
        rgba[idx + 1] = Math.round(clamp(gAcc / aAcc, 0, 255));
        rgba[idx + 2] = Math.round(clamp(bAcc / aAcc, 0, 255));
        rgba[idx + 3] = Math.round(clamp(finalA * 255, 0, 255));
      }
    }
  }

  return encodeRgbaToPng(size, size, rgba);
}

/**
 * Render monochrome macOS Menu Bar Template Icon (black + alpha only)
 */
function renderTemplateIcon(size: number): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const pixelScale = 1024 / size;
  const aa = pixelScale * 1.1;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 1024;
      const y = ((py + 0.5) / size) * 1024;

      const bowRingDist = Math.abs(Math.hypot(x - 360, y - 512) - 180) - 52;
      const shaftDist = distToSegment(x, y, 520, 512, 860, 512) - 52;
      const tooth1Dist = distToSegment(x, y, 680, 512, 680, 680) - 48;
      const tooth2Dist = distToSegment(x, y, 810, 512, 810, 720) - 48;
      const d = Math.min(bowRingDist, shaftDist, tooth1Dist, tooth2Dist);

      const alpha = 1 - smoothstep(-aa, aa, d);
      const idx = (py * size + px) * 4;
      rgba[idx] = 0;
      rgba[idx + 1] = 0;
      rgba[idx + 2] = 0;
      rgba[idx + 3] = Math.round(clamp(alpha * 255, 0, 255));
    }
  }

  return encodeRgbaToPng(size, size, rgba);
}

/**
 * Build an Apple .icns binary container from PNG buffers
 */
function buildIcnsFromPngs(entries: { osType: string; png: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  let totalLen = 8; // 'icns' + 4-byte total length

  for (const entry of entries) {
    const chunkLen = 8 + entry.png.length;
    const header = Buffer.alloc(8);
    header.write(entry.osType, 0, 4, 'ascii');
    header.writeUInt32BE(chunkLen, 4);
    chunks.push(header, entry.png);
    totalLen += chunkLen;
  }

  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 4, 'ascii');
  fileHeader.writeUInt32BE(totalLen, 4);

  return Buffer.concat([fileHeader, ...chunks]);
}

async function main() {
  const assetsDir = path.resolve(process.cwd(), 'assets');
  const iconsetDir = path.join(assetsDir, 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });

  console.log('Generating raster PNG icons from vector geometry...');
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  const pngBySize = new Map<number, Buffer>();

  for (const s of sizes) {
    pngBySize.set(s, renderIconSize(s));
  }

  // Write master 1024x1024 icon.png
  const masterPng = pngBySize.get(1024)!;
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), masterPng);

  // Write macOS icon.iconset files
  const iconsetMapping: [string, number][] = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];

  for (const [filename, dim] of iconsetMapping) {
    fs.writeFileSync(path.join(iconsetDir, filename), pngBySize.get(dim)!);
  }

  // Write monochrome Menu Bar Template icons (18x18 and 36x36)
  fs.writeFileSync(path.join(assetsDir, 'iconTemplate.png'), renderTemplateIcon(18));
  fs.writeFileSync(path.join(assetsDir, 'iconTemplate@2x.png'), renderTemplateIcon(36));

  // Build assets/icon.icns
  const icnsPath = path.join(assetsDir, 'icon.icns');
  if (process.platform === 'darwin') {
    try {
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
      console.log('Created assets/icon.icns via macOS iconutil.');
      return;
    } catch {
      // Fallback to binary ICNS writer if iconutil fails
    }
  }

  const icnsBuffer = buildIcnsFromPngs([
    { osType: 'icp4', png: pngBySize.get(16)! },
    { osType: 'icp5', png: pngBySize.get(32)! },
    { osType: 'icp6', png: pngBySize.get(64)! },
    { osType: 'ic07', png: pngBySize.get(128)! },
    { osType: 'ic08', png: pngBySize.get(256)! },
    { osType: 'ic09', png: pngBySize.get(512)! },
    { osType: 'ic10', png: pngBySize.get(1024)! },
    { osType: 'ic11', png: pngBySize.get(32)! },
    { osType: 'ic12', png: pngBySize.get(64)! },
    { osType: 'ic13', png: pngBySize.get(256)! },
    { osType: 'ic14', png: pngBySize.get(512)! },
  ]);
  fs.writeFileSync(icnsPath, icnsBuffer);
  console.log(`Generated assets/icon.png, assets/icon.iconset/*, assets/iconTemplate*.png, and assets/icon.icns (${icnsBuffer.length} bytes).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
