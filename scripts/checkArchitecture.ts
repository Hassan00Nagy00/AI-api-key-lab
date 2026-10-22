import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Mechanical Architecture, Canonical Single-Source-of-Truth & Late-Binding Linter (`scripts/checkArchitecture.ts`).
 * Enforces §0A.1, §0A.2 & §0A.6:
 * 1. Only `src/domain/canonical.ts` may define `KEY_STATUSES`, `ERROR_CATEGORIES`,
 *    `type KeyStatus =`, or `type ErrorCategory =`.
 * 2. Only `src/services/executor.ts` (ApiExecutor) and `src/services/secretStore.ts` (SecretStore)
 *    may import `secretVault`.
 * 3. UI modules (`src/views/*`, `src/components/*`, `src/hooks/*`, `src/App.tsx`),
 *    adapters (`src/adapters/*`), and non-secret services (`src/services/modelSelector.ts`,
 *    `src/services/testService.ts`, `src/services/chatService.ts`, `src/services/errorClassifier.ts`,
 *    `src/services/diagnosticsService.ts`, etc.) must NEVER import `secretVault` or `secretStore`
 *    or call `secretStore.getSecret(`.
 */

const CANONICAL_SOURCE_FILE = path.normalize('src/domain/canonical.ts');

const ALLOWED_SECRET_VAULT_IMPORTERS = new Set([
  path.normalize('src/services/executor.ts'),
  path.normalize('src/services/secretStore.ts'),
]);

const FORBIDDEN_SECRET_STORE_CONSUMERS = [
  path.normalize('src/views/'),
  path.normalize('src/components/'),
  path.normalize('src/hooks/'),
  path.normalize('src/App.tsx'),
  path.normalize('src/adapters/'),
  path.normalize('src/services/modelSelector.ts'),
  path.normalize('src/services/testService.ts'),
  path.normalize('src/services/chatService.ts'),
  path.normalize('src/services/errorClassifier.ts'),
  path.normalize('src/services/responseValidator.ts'),
  path.normalize('src/services/diagnosticsService.ts'),
  path.normalize('src/services/diagnosticsBundleService.ts'),
  path.normalize('src/services/budgetService.ts'),
  path.normalize('src/services/expiryService.ts'),
  path.normalize('src/services/providerDetector.ts'),
  path.normalize('src/services/modelWatchAndQuota.ts'),
  path.normalize('src/services/schedulerService.ts'),
];

export function auditLateBindingImports(
  rootDir: string = process.cwd(),
  virtualFiles: { relPath: string; content: string }[] = []
): {
  passed: boolean;
  violations: string[];
  scannedFiles: number;
} {
  const violations: string[] = [];
  let scannedFiles = 0;

  function inspectFileContent(relPath: string, content: string) {
    // 0. Canonical Single-Source-of-Truth check (§0A.2):
    // No file other than src/domain/canonical.ts may define status or category values
    if (relPath !== CANONICAL_SOURCE_FILE && !relPath.startsWith(path.normalize('src/test/'))) {
      if (
        /\btype\s+KeyStatus\s*=/.test(content) ||
        /\btype\s+ErrorCategory\s*=/.test(content) ||
        /\bconst\s+KEY_STATUSES\s*=/.test(content) ||
        /\bconst\s+ERROR_CATEGORIES\s*=/.test(content)
      ) {
        violations.push(
          `[§0A.2 Canonical Single-Source Violation] ${relPath} defines KeyStatus or ErrorCategory directly. Only src/domain/canonical.ts may define canonical status or category values.`
        );
      }
    }

    // 1. Check imports of secretVault
    const importsSecretVault =
      /from\s+['"][^'"]*secretVault['"]/.test(content) ||
      /import\s*\(\s*['"][^'"]*secretVault['"]\s*\)/.test(content);

    if (importsSecretVault && !ALLOWED_SECRET_VAULT_IMPORTERS.has(relPath)) {
      violations.push(
        `[§0A.6 Late-Binding Violation] ${relPath} imports secretVault. Only src/services/executor.ts and src/services/secretStore.ts may import secretVault.`
      );
    }

    // 2. Check forbidden modules (including UI modules, adapters, and services) for any import of secretStore
    const isForbiddenConsumer = FORBIDDEN_SECRET_STORE_CONSUMERS.some(
      (prefix) => relPath === prefix || relPath.startsWith(prefix)
    );
    if (isForbiddenConsumer) {
      if (
        /from\s+['"][^'"]*secretStore['"]/.test(content) ||
        /import\s*\(\s*['"][^'"]*secretStore['"]\s*\)/.test(content)
      ) {
        violations.push(
          `[§0A.6 Late-Binding Violation] ${relPath} imports secretStore directly. UI modules, adapters, and non-executor services must never import secretStore.`
        );
      }
      if (/\bsecretStore\.getSecret\s*\(/.test(content) || /\bSecretVault\./.test(content)) {
        violations.push(
          `[§0A.6 Late-Binding Violation] ${relPath} accesses secretStore/SecretVault directly instead of using {{secret}} late binding via ApiExecutor.`
        );
      }
    }
  }

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        scannedFiles++;
        const relPath = path.normalize(path.relative(rootDir, fullPath));
        const content = fs.readFileSync(fullPath, 'utf8');
        inspectFileContent(relPath, content);
      }
    }
  }

  walk(path.join(rootDir, 'src'));

  for (const vf of virtualFiles) {
    scannedFiles++;
    inspectFileContent(path.normalize(vf.relPath), vf.content);
  }

  return {
    passed: violations.length === 0,
    violations,
    scannedFiles,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = auditLateBindingImports();
  if (!result.passed) {
    console.error('Architecture & Late-Binding Check FAILED:');
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log(
    `Architecture & Late-Binding Check PASSED (${result.scannedFiles} source files verified).`
  );
}
