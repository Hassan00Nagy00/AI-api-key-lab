import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KEY_STATUSES,
  ERROR_CATEGORIES,
  AUTH_VERIFIED_VALUES,
  MODEL_TIERS,
  TIER_EVIDENCES,
  MODEL_AVAILABILITIES,
  ERROR_CATEGORY_TO_KEY_STATUS,
} from '../domain/canonical';
import { auditLateBindingImports } from '../../scripts/checkArchitecture';

test('Canonical Rules (§0A.1 & §2) — docs/CANONICAL.md and src/domain/canonical.ts are in 100% parity', () => {
  const canonicalDocPath = path.resolve(process.cwd(), 'docs/CANONICAL.md');
  assert.equal(fs.existsSync(canonicalDocPath), true, 'docs/CANONICAL.md must exist');
  const docText = fs.readFileSync(canonicalDocPath, 'utf8');

  // 1. Bidirectional KEY_STATUS parity between src/domain/canonical.ts and docs/CANONICAL.md
  const keyStatusLine = docText.split('\n').find((l) => l.startsWith('- `untested`')) ?? '';
  const docStatuses = Array.from(new Set(Array.from(keyStatusLine.matchAll(/`([a-z-]+)`/g), (m) => m[1])));
  assert.deepEqual(
    docStatuses,
    [...KEY_STATUSES],
    'docs/CANONICAL.md KEY STATUS list must match KEY_STATUSES in src/domain/canonical.ts in exact order'
  );

  // 2. Bidirectional ERROR_CATEGORY parity between src/domain/canonical.ts and docs/CANONICAL.md
  for (const category of ERROR_CATEGORIES) {
    const existsInDoc =
      docText.includes(`\`${category}\``) ||
      (category === 'unknown' && docText.includes('`unknown-error`'));
    assert.equal(
      existsInDoc,
      true,
      `ERROR_CATEGORY "${category}" from src/domain/canonical.ts missing in docs/CANONICAL.md`
    );
    assert.equal(
      KEY_STATUSES.includes(ERROR_CATEGORY_TO_KEY_STATUS[category]),
      true,
      `ERROR_CATEGORY "${category}" maps to invalid status "${ERROR_CATEGORY_TO_KEY_STATUS[category]}"`
    );
  }

  // 3. Every MODEL_TIER, TIER_EVIDENCE, MODEL_AVAILABILITY, AUTH_VERIFIED_VALUE appears in docs/CANONICAL.md
  for (const tier of MODEL_TIERS) {
    assert.equal(docText.includes(tier), true, `MODEL_TIER "${tier}" missing in docs/CANONICAL.md`);
  }
  for (const ev of TIER_EVIDENCES) {
    assert.equal(docText.includes(ev), true, `TIER_EVIDENCE "${ev}" missing in docs/CANONICAL.md`);
  }
  for (const av of MODEL_AVAILABILITIES) {
    assert.equal(docText.includes(av), true, `MODEL_AVAILABILITY "${av}" missing in docs/CANONICAL.md`);
  }
  for (const authVal of AUTH_VERIFIED_VALUES) {
    assert.equal(docText.includes(`"${authVal}"`), true, `AUTH_VERIFIED "${authVal}" missing in docs/CANONICAL.md`);
  }

  // 4. Verify AGENTS.md, CLAUDE.md, and SPEC.md exist and enforce AGENTS.md Hard Rule 9 (exact versions + SPEC.md justifications)
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'AGENTS.md')), true, 'AGENTS.md must exist');
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'CLAUDE.md')), true, 'CLAUDE.md must exist');
  const specText = fs.readFileSync(path.resolve(process.cwd(), 'SPEC.md'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'devDependencies'] as const) {
    for (const [depName, version] of Object.entries((pkg[section] ?? {}) as Record<string, string>)) {
      assert.equal(
        /^[0-9]+\.[0-9]+\.[0-9]+/.test(version),
        true,
        `AGENTS.md Rule 9: package.json ${section}.${depName} must use an exact version, found "${version}"`
      );
      assert.equal(
        specText.includes(`\`${depName}\``),
        true,
        `AGENTS.md Rule 9: dependency "${depName}" must have a justification in SPEC.md`
      );
    }
  }
});

test('Mechanical Late-Binding (§0A.6) — zero unauthorized imports of secretVault across src/', () => {
  const result = auditLateBindingImports(process.cwd());
  assert.equal(result.passed, true);
  assert.deepEqual(
    result.violations,
    [],
    `Found unauthorized secretVault imports: ${JSON.stringify(result.violations)}`
  );
});
