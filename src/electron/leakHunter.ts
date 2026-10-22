import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_PROVIDERS, DEFAULT_PROVIDER_KEY_FORMATS } from '../providers/catalog';
import { ProviderConfig } from '../types/provider';
import { SanitizedLogger, writeFileAtomicSync } from './jsonStore';

export const MAX_SCAN_FILE_BYTES = 1024 * 1024; // 1 MB cap per file

export const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  'release',
  '.next',
  'out',
  'coverage',
  '.venv',
  'venv',
  'target',
  'vendor',
  '.cache',
  '.turbo',
]);

export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.icns',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.7z',
  '.dmg',
  '.pkg',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.sqlite',
  '.db',
  '.pyc',
  '.class',
  '.o',
  '.a',
]);

export interface LeakFinding {
  id: string;
  providerId: string;
  providerName: string;
  filePath: string;
  relativePath: string;
  lineNumber: number;
  maskedFingerprint: string; // e.g. "sk-••••7F3A" — full match is NEVER stored or returned
  isGitRepo: boolean;
  rotated: boolean;
}

export interface LeakScanReport {
  scannedFolders: string[];
  scannedAt: string;
  filesScanned: number;
  filesSkipped: number;
  containsGitRepo: boolean;
  gitWarning: string | null;
  findings: LeakFinding[];
}

interface CompiledPattern {
  providerId: string;
  providerName: string;
  prefix: string;
  minLength: number;
  maxLength: number;
  regex: RegExp;
}

/**
 * Produces a strictly masked fingerprint like "sk-••••7F3A" or "gsk_••••9B2C".
 * Never returns more than the short provider prefix and the final 4 characters.
 */
export function maskLeakedSecret(rawMatch: string, prefixHint?: string): string {
  const clean = rawMatch.trim();
  const suffix = clean.slice(-4);

  let displayPrefix = 'key-';
  if (clean.startsWith('sk-ant-')) displayPrefix = 'sk-ant-';
  else if (clean.startsWith('sk-or-')) displayPrefix = 'sk-or-';
  else if (clean.startsWith('sk-proj-')) displayPrefix = 'sk-';
  else if (clean.startsWith('sk-')) displayPrefix = 'sk-';
  else if (clean.startsWith('gsk_')) displayPrefix = 'gsk_';
  else if (clean.startsWith('AIza')) displayPrefix = 'AIza';
  else if (clean.startsWith('xai-')) displayPrefix = 'xai-';
  else if (clean.startsWith('nvapi-')) displayPrefix = 'nvapi-';
  else if (clean.startsWith('hf_')) displayPrefix = 'hf_';
  else if (clean.startsWith('fw_')) displayPrefix = 'fw_';
  else if (clean.startsWith('csk-')) displayPrefix = 'csk-';
  else if (clean.startsWith('pplx-')) displayPrefix = 'pplx-';
  else if (clean.startsWith('r8_')) displayPrefix = 'r8_';
  else if (prefixHint) displayPrefix = prefixHint.slice(0, 6);

  return `${displayPrefix}••••${suffix}`;
}

/**
 * Checks whether a buffer looks like a binary file by checking for NUL bytes in the first 4096 bytes.
 */
export function isBinaryBuffer(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 4096);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Compiles detection patterns from the provider registry (prefix + length + regex rules).
 */
export function buildRegistryKeyPatterns(providers: ProviderConfig[] = BUNDLED_PROVIDERS): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  const seenKey = new Set<string>();

  const providerNameMap = new Map<string, string>();
  for (const p of providers) {
    providerNameMap.set(p.id, p.name);
  }
  // Fallback names for common providers even if not in custom subset
  const fallbackNames: Record<string, string> = {
    'google-gemini': 'Google Gemini',
    groq: 'Groq',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    anthropic: 'Anthropic Claude',
    xai: 'xAI (Grok)',
    'nvidia-nim': 'NVIDIA NIM',
    'huggingface-inference': 'Hugging Face',
    'fireworks-ai': 'Fireworks AI',
    cerebras: 'Cerebras',
    perplexity: 'Perplexity',
    replicate: 'Replicate',
  };

  // 1. Patterns from active providers
  for (const p of providers) {
    const formats = p.keyFormats || DEFAULT_PROVIDER_KEY_FORMATS[p.id];
    if (!formats) continue;
    for (const fmt of formats) {
      const key = `${p.id}:${fmt.regex}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      compiled.push({
        providerId: p.id,
        providerName: p.name,
        prefix: fmt.prefix,
        minLength: fmt.minLength,
        maxLength: fmt.maxLength || 256,
        regex: new RegExp(fmt.regex, 'g'),
      });
    }
  }

  // 2. Ensure all default registry patterns are included
  for (const [providerId, formats] of Object.entries(DEFAULT_PROVIDER_KEY_FORMATS)) {
    for (const fmt of formats) {
      const key = `${providerId}:${fmt.regex}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      compiled.push({
        providerId,
        providerName: providerNameMap.get(providerId) || fallbackNames[providerId] || providerId,
        prefix: fmt.prefix,
        minLength: fmt.minLength,
        maxLength: fmt.maxLength || 256,
        regex: new RegExp(fmt.regex, 'g'),
      });
    }
  }

  return compiled;
}

export class LeakHunterService {
  private userDataDir: string;
  private rotatedStorePath: string;
  private logger?: SanitizedLogger;
  private rotatedIds: Set<string> = new Set();
  private authorizedFolders: Set<string> = new Set();

  constructor(opts: { userDataDir: string; logger?: SanitizedLogger }) {
    this.userDataDir = opts.userDataDir;
    this.logger = opts.logger;
    fs.mkdirSync(this.userDataDir, { recursive: true });
    this.rotatedStorePath = path.join(this.userDataDir, 'rotated_leaks.json');
    this.loadRotatedIds();
  }

  private loadRotatedIds(): void {
    if (!fs.existsSync(this.rotatedStorePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.rotatedStorePath, 'utf8'));
      if (Array.isArray(raw)) {
        this.rotatedIds = new Set(raw.filter((x) => typeof x === 'string'));
      }
    } catch {
      this.rotatedIds = new Set();
    }
  }

  private saveRotatedIds(): void {
    writeFileAtomicSync(this.rotatedStorePath, JSON.stringify([...this.rotatedIds], null, 2), 0o600);
  }

  /**
   * Scans ONLY the folders explicitly chosen by the user.
   * Never scans root disk ("/") or home directory silently unless explicitly selected,
   * skips node_modules/.git/dist/build/release and binary files, and caps file size at 1 MB.
   */
  public scanExplicitFolders(
    folderPaths: string[],
    providers: ProviderConfig[] = BUNDLED_PROVIDERS
  ): LeakScanReport {
    const validFolders: string[] = [];
    for (const rawFolder of folderPaths) {
      if (!rawFolder || typeof rawFolder !== 'string') continue;
      const resolved = path.resolve(rawFolder);
      // Never allow scanning the entire filesystem root "/"
      if (resolved === path.parse(resolved).root) {
        throw new Error('Refusing to scan the entire filesystem root directory.');
      }
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        validFolders.push(resolved);
        this.authorizedFolders.add(resolved);
      }
    }

    const patterns = buildRegistryKeyPatterns(providers);
    const findings: LeakFinding[] = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    let containsGitRepo = false;

    for (const rootFolder of validFolders) {
      const folderHasGit = this.checkIsGitRepository(rootFolder);
      if (folderHasGit) {
        containsGitRepo = true;
      }

      this.walkFolder({
        currentDir: rootFolder,
        rootFolder,
        isGitRepo: folderHasGit,
        patterns,
        findings,
        onFileScanned: () => {
          filesScanned++;
        },
        onFileSkipped: () => {
          filesSkipped++;
        },
      });
    }

    const gitWarning = containsGitRepo
      ? 'Git repository detected (.git found). Removing a plain-text API key from a working file does NOT remove it from prior Git commits or reflogs. Rotate affected keys immediately on the provider dashboard.'
      : null;

    // Log ONLY summary counts, never any secret or raw match
    this.logger?.log('INFO', 'Completed Leak Hunter folder scan', {
      folderCount: validFolders.length,
      filesScanned,
      filesSkipped,
      findingsCount: findings.length,
      containsGitRepo,
    });

    return {
      scannedFolders: validFolders,
      scannedAt: new Date().toISOString(),
      filesScanned,
      filesSkipped,
      containsGitRepo,
      gitWarning,
      findings,
    };
  }

  public markFindingRotated(findingId: string, rotated: boolean): { id: string; rotated: boolean } {
    if (!findingId || typeof findingId !== 'string') {
      throw new Error('Invalid findingId');
    }
    if (rotated) {
      this.rotatedIds.add(findingId);
    } else {
      this.rotatedIds.delete(findingId);
    }
    this.saveRotatedIds();
    return { id: findingId, rotated };
  }

  public isAuthorizedFilePath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    for (const folder of this.authorizedFolders) {
      if (resolved.startsWith(folder + path.sep) || resolved === folder) {
        return true;
      }
    }
    return false;
  }

  private checkIsGitRepository(folderPath: string): boolean {
    try {
      const gitPath = path.join(folderPath, '.git');
      return fs.existsSync(gitPath);
    } catch {
      return false;
    }
  }

  private walkFolder(ctx: {
    currentDir: string;
    rootFolder: string;
    isGitRepo: boolean;
    patterns: CompiledPattern[];
    findings: LeakFinding[];
    onFileScanned: () => void;
    onFileSkipped: () => void;
  }): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(ctx.currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(ctx.currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        ctx.onFileSkipped();
        continue;
      }

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
          ctx.onFileSkipped();
          continue;
        }
        const subGit = ctx.isGitRepo || this.checkIsGitRepository(fullPath);
        this.walkFolder({
          ...ctx,
          currentDir: fullPath,
          isGitRepo: subGit,
        });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        ctx.onFileSkipped();
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        ctx.onFileSkipped();
        continue;
      }

      if (stat.size === 0 || stat.size > MAX_SCAN_FILE_BYTES) {
        ctx.onFileSkipped();
        continue;
      }

      let buf: Buffer;
      try {
        buf = fs.readFileSync(fullPath);
      } catch {
        ctx.onFileSkipped();
        continue;
      }

      if (isBinaryBuffer(buf)) {
        ctx.onFileSkipped();
        continue;
      }

      ctx.onFileScanned();
      const content = buf.toString('utf8');
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.length < 20 || line.length > 8192) continue;

        for (const pat of ctx.patterns) {
          if (!line.includes(pat.prefix)) continue;

          pat.regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pat.regex.exec(line)) !== null) {
            const rawSecret = match[0];
            if (rawSecret.length < pat.minLength || rawSecret.length > pat.maxLength) {
              continue;
            }
            // Ignore obvious masked or placeholder strings
            if (rawSecret.includes('••••') || /^([A-Za-z0-9_-])\1{15,}$/.test(rawSecret.slice(pat.prefix.length))) {
              continue;
            }

            const maskedFingerprint = maskLeakedSecret(rawSecret, pat.prefix);
            const lineNumber = i + 1;
            const relativePath = path.relative(ctx.rootFolder, fullPath);

            // Deterministic ID derived ONLY from public metadata + maskedFingerprint (never rawSecret)
            const id = crypto
              .createHash('sha256')
              .update(`${fullPath}:${lineNumber}:${pat.providerId}:${maskedFingerprint}`)
              .digest('hex')
              .slice(0, 16);

            // Avoid duplicate finding on the same line for the same masked fingerprint
            if (!ctx.findings.some((f) => f.id === id)) {
              ctx.findings.push({
                id,
                providerId: pat.providerId,
                providerName: pat.providerName,
                filePath: fullPath,
                relativePath,
                lineNumber,
                maskedFingerprint,
                isGitRepo: ctx.isGitRepo,
                rotated: this.rotatedIds.has(id),
              });
            }
          }
        }
      }
    }
  }
}
