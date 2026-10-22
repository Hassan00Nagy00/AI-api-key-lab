import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

async function buildElectronBundles() {
  const outDir = path.resolve(process.cwd(), 'dist-electron');
  fs.mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: ['src/electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
    minify: false,
  });

  await build({
    entryPoints: ['src/electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
    minify: false,
  });

  console.log('Built dist-electron/main.cjs and dist-electron/preload.cjs successfully.');
}

buildElectronBundles().catch((err) => {
  console.error(err);
  process.exit(1);
});
