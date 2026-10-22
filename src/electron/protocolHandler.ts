import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export const PACKAGED_CSP = [
  "default-src 'self' app:;",
  "script-src 'self' app:;",
  "style-src 'self' app: 'unsafe-inline';",
  "img-src 'self' app: data: blob:;",
  "font-src 'self' app: data:;",
  "connect-src 'self';",
  "object-src 'none';",
  "base-uri 'self';",
  "form-action 'none';",
  "frame-ancestors 'none';",
].join(' ');

/**
 * Resolves a request URL for the custom `app://` protocol against `distRoot`,
 * enforcing strict path-traversal containment and SPA `index.html` fallback.
 */
export function resolveAppProtocolRequest(
  requestUrl: string,
  distRoot: string
): { status: number; filePath?: string; mimeType: string; headers: Record<string, string> } {
  const normalizedDistRoot = path.resolve(distRoot);
  const baseHeaders: Record<string, string> = {
    'Content-Security-Policy': PACKAGED_CSP,
    'X-Content-Type-Options': 'nosniff',
  };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return { status: 400, mimeType: 'text/plain', headers: baseHeaders };
  }

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(parsedUrl.pathname || '/');
  } catch {
    return { status: 400, mimeType: 'text/plain', headers: baseHeaders };
  }

  // Reject null bytes or explicit traversal sequences
  if (decodedPathname.includes('\0') || decodedPathname.includes('..')) {
    return { status: 403, mimeType: 'text/plain', headers: baseHeaders };
  }

  const relativePath = decodedPathname.replace(/^\/+/, '') || 'index.html';
  const candidatePath = path.resolve(normalizedDistRoot, relativePath);

  // Containment check: candidatePath must reside inside normalizedDistRoot
  if (
    candidatePath !== normalizedDistRoot &&
    !candidatePath.startsWith(normalizedDistRoot + path.sep)
  ) {
    return { status: 403, mimeType: 'text/plain', headers: baseHeaders };
  }

  // Serve exact static asset if it exists and is a file
  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    const ext = path.extname(candidatePath).toLowerCase();
    return {
      status: 200,
      filePath: candidatePath,
      mimeType: MIME_TYPES[ext] || 'application/octet-stream',
      headers: baseHeaders,
    };
  }

  // If the request has a file extension (e.g. .js, .css, .png) and was not found, return 404
  const ext = path.extname(relativePath).toLowerCase();
  if (ext && ext !== '.html') {
    return { status: 404, mimeType: 'text/plain', headers: baseHeaders };
  }

  // Otherwise SPA navigation route fallback (/dashboard, /keys, /settings, etc.) -> index.html
  const indexHtmlPath = path.join(normalizedDistRoot, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    return {
      status: 200,
      filePath: indexHtmlPath,
      mimeType: 'text/html; charset=utf-8',
      headers: baseHeaders,
    };
  }

  return { status: 404, mimeType: 'text/plain', headers: baseHeaders };
}
