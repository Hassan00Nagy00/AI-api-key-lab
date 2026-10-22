import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface CheckResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
}

const EVIDENCE_DIR = path.resolve(process.cwd(), 'reports/evidence');
const REPORT_PATH = path.resolve(process.cwd(), 'VALIDATION_REPORT.md');

function runCheck(name: string, command: string, evidenceFile: string): CheckResult {
  try {
    const out = execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.writeFileSync(path.join(EVIDENCE_DIR, evidenceFile), out || 'EXIT 0 (clean)\n', 'utf-8');
    return { name, command, passed: true, output: out };
  } catch (err: any) {
    const out = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + (err.message || '');
    fs.writeFileSync(path.join(EVIDENCE_DIR, evidenceFile), out, 'utf-8');
    return { name, command, passed: false, output: out };
  }
}

function scanBuildForSecrets(): CheckResult {
  const distDir = path.resolve(process.cwd(), 'dist');
  const secretRegex = /(sk-[a-zA-Z0-9]{20,}|gsk_[a-zA-Z0-9]{20,}|AIzaSy[a-zA-Z0-9_-]{33}|nvapi-[a-zA-Z0-9_-]{20,})/;
  const matches: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(js|css|html|json|map)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf-8');
        const m = content.match(secretRegex);
        if (m) {
          matches.push(`${entry.name}: matched pattern ${m[0].slice(0, 6)}...`);
        }
      }
    }
  }

  walk(distDir);
  const passed = matches.length === 0;
  const summary = passed
    ? `PASS: Scanned dist/ build artifacts — 0 hardcoded API secrets or private tokens found.\n`
    : `FAIL: Found potential secret patterns in dist/:\n${matches.join('\n')}\n`;

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'build-secret-scan.txt'), summary, 'utf-8');
  return {
    name: 'Build Output Secret Scan',
    command: 'scan dist/ for secret patterns',
    passed,
    output: summary,
  };
}

function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('=== AI API Key Lab — Automated Report & Evidence Verification ===');

  const results: CheckResult[] = [
    runCheck('Lint Check', 'npm run lint', 'lint.txt'),
    runCheck('Typecheck', 'npm run typecheck', 'typecheck.txt'),
    runCheck('Unit Tests', 'npm test', 'unit-tests.txt'),
    runCheck('Fake Provider Gate (test:gate)', 'npm run test:gate', 'test-gate.txt'),
    runCheck('Production Build', 'npm run build', 'build.txt'),
    scanBuildForSecrets(),
  ];

  let allPassed = true;
  for (const r of results) {
    const statusStr = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${statusStr}] ${r.name} (${r.command})`);
    if (!r.passed) {
      allPassed = false;
      console.error(r.output);
    }
  }

  // Verify VALIDATION_REPORT.md exists and matches live check statuses
  if (fs.existsSync(REPORT_PATH)) {
    const reportContent = fs.readFileSync(REPORT_PATH, 'utf-8');
    const hasUnverifiedPass = !allPassed && reportContent.includes('READY FOR STEP 3: YES');
    if (hasUnverifiedPass) {
      console.error('[FAIL] VALIDATION_REPORT.md claims READY FOR STEP 3: YES while a check failed.');
      process.exit(1);
    }
    console.log('[PASS] VALIDATION_REPORT.md verified against live check results.');
  } else {
    console.log('[INFO] VALIDATION_REPORT.md not yet generated; evidence files written to reports/evidence/.');
  }

  if (!allPassed) {
    process.exit(1);
  }
  console.log('=== All verification checks PASSED and evidence pack updated in reports/evidence/ ===');
}

main();
