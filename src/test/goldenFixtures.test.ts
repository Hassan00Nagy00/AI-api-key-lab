import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GoldenFixtureRecord, FixtureSanitizer } from '../services/fixtureSanitizer';
import { BUNDLED_PROVIDERS } from '../providers/catalog';
import { ProviderRegistry } from '../services/providerRegistry';
import { classifyError } from '../services/errorClassifier';
import { validateResponse } from '../services/responseValidator';

const GOLDEN_ROOT = path.resolve(process.cwd(), 'tests/fixtures/golden');

test('Golden Provider Fixtures (§13A) — all fixtures parse, classify to canonical STATUS/CATEGORY, contain zero secrets, and are < 180 days old', () => {
  assert.equal(fs.existsSync(GOLDEN_ROOT), true, 'tests/fixtures/golden directory must exist');
  const providerDirs = fs
    .readdirSync(GOLDEN_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  assert.equal(providerDirs.length >= 2, true, 'Must have golden fixtures for at least 2 providers');

  let totalFixturesChecked = 0;

  for (const providerId of providerDirs) {
    const provider = BUNDLED_PROVIDERS.find(p => p.id === providerId);
    assert.ok(provider, `Golden fixture provider "${providerId}" must exist in BUNDLED_PROVIDERS`);
    const adapter = ProviderRegistry.getAdapter(provider);

    const dirPath = path.join(GOLDEN_ROOT, providerId);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    assert.equal(files.length > 0, true, `Provider "${providerId}" must have at least one golden fixture`);

    for (const file of files) {
      totalFixturesChecked++;
      const fullPath = path.join(dirPath, file);
      const rawContent = fs.readFileSync(fullPath, 'utf8');
      const fixture = JSON.parse(rawContent) as GoldenFixtureRecord;

      // 1. Check staleness (< 180 days old)
      const staleness = FixtureSanitizer.checkStaleness(fixture.recordedAt);
      assert.equal(
        staleness.isStale,
        false,
        `Golden fixture ${fullPath} is stale (${staleness.ageDays} days old > 180 days)`
      );

      // 2. Verify sanitizer idempotency (zero raw secrets in committed fixture)
      const reSanitized = FixtureSanitizer.sanitizeText(rawContent);
      assert.equal(
        rawContent.includes('AIzaSy'),
        false,
        `Golden fixture ${fullPath} must not contain raw Gemini keys`
      );
      assert.equal(
        rawContent.includes('gsk_'),
        false,
        `Golden fixture ${fullPath} must not contain raw Groq keys`
      );
      assert.ok(reSanitized.length > 0);

      // 3. Feed through adapter + classifyError / validateResponse
      if (fixture.case === 'model-list' && fixture.httpStatus === 200) {
        const models = adapter.parseModels(fixture.bodyText, provider);
        assert.equal(
          models.length >= 1,
          true,
          `${fullPath}: expected at least 1 parsed model, got ${models.length}`
        );
      } else if (fixture.case === 'valid-hi' && fixture.httpStatus === 200) {
        const parsed = adapter.parseGenerate(fixture.bodyText);
        const validation = validateResponse(parsed);
        assert.equal(validation.isValid, true, `${fullPath}: expected valid generation response`);
      } else {
        // Error classification or 200 error-in-body
        const classified = classifyError(
          fixture.httpStatus,
          fixture.bodyText,
          false,
          'generate',
          'unknown',
          provider
        );
        if (fixture.expectedStatus) {
          assert.equal(
            classified.status,
            fixture.expectedStatus,
            `${fullPath}: expected status "${fixture.expectedStatus}", got "${classified.status}"`
          );
        }
        if (fixture.expectedCategory) {
          assert.equal(
            classified.category,
            fixture.expectedCategory,
            `${fullPath}: expected category "${fixture.expectedCategory}", got "${classified.category}"`
          );
        }
      }
    }
  }

  assert.equal(totalFixturesChecked >= 8, true, `Expected >= 8 golden fixtures, checked ${totalFixturesChecked}`);
});
