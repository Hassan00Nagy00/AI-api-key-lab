import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { BUNDLED_PROVIDERS } from '../src/providers/catalog';
import { ProviderRegistry } from '../src/services/providerRegistry';
import { FixtureSanitizer, GoldenFixtureCase } from '../src/services/fixtureSanitizer';

/**
 * Golden Fixture Recorder (`scripts/record-fixtures.ts` -> `npm run fixtures:record`) per §13A.
 * Run ONLY by the user in their own Terminal:
 * - Reads the key through a hidden (no-echo) prompt — NEVER argv, NEVER an environment variable, NEVER a file.
 * - Records real, sanitized responses for: model list, a valid "Hi", a wrong key, a wrong model id, and (optional) rate-limit.
 * - Writes `tests/fixtures/golden/<providerId>/<case>.json`.
 */

function assertNoKeyInArgv(): void {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (
      arg.startsWith('AIza') ||
      arg.startsWith('sk-') ||
      arg.startsWith('gsk_') ||
      arg.startsWith('nvapi-') ||
      arg.startsWith('csk-') ||
      arg.startsWith('hf_') ||
      arg.includes('key=') ||
      arg.length > 32
    ) {
      console.error(
        'SECURITY ERROR: Never pass an API key via command-line arguments (argv). Run `npm run fixtures:record` and type the key at the hidden prompt.'
      );
      process.exit(1);
    }
  }
}

function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHiddenKey(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'Interactive TTY is required for hidden (no-echo) key input. Never pipe a key from a file or env var.'
        )
      );
      return;
    }

    process.stdout.write(promptText);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let secret = '';
    const onData = (char: string) => {
      if (char === '\r' || char === '\n' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(secret.trim());
      } else if (char === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\nAborted.\n');
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') {
        secret = secret.slice(0, -1);
      } else {
        secret += char;
      }
    };

    process.stdin.on('data', onData);
  });
}

async function executePreparedWithSecret(
  req: { url: string; method: string; headers: Record<string, string>; body?: unknown },
  secret: string
): Promise<{ status: number; headers: Record<string, string>; bodyText: string }> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = v.replace(/\{\{secret\}\}/g, secret);
  }
  const body =
    req.body === undefined
      ? undefined
      : typeof req.body === 'string'
      ? req.body.replace(/\{\{secret\}\}/g, secret)
      : JSON.stringify(req.body).replace(/\{\{secret\}\}/g, secret);

  const response = await fetch(req.url, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
  });

  const resHeaders: Record<string, string> = {};
  response.headers.forEach((val, key) => {
    resHeaders[key.toLowerCase()] = val;
  });

  const bodyText = await response.text();
  return { status: response.status, headers: resHeaders, bodyText };
}

async function main() {
  assertNoKeyInArgv();

  console.log('=== AI API Key Lab — Golden Fixture Recorder (§13A) ===');
  console.log('Security rule: Keys are read ONLY from the hidden TTY prompt (never argv, env, or files).\n');

  const providerArg = process.argv.find(a => a.startsWith('--provider='))?.split('=')[1];
  const providerId =
    providerArg || (await promptLine('Enter provider ID (e.g. google-gemini, groq, openrouter): '));

  const provider = BUNDLED_PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    console.error(`Unknown provider ID: "${providerId}". Available: ${BUNDLED_PROVIDERS.map(p => p.id).join(', ')}`);
    process.exit(1);
  }

  const secretKey = await promptHiddenKey(`Enter real API key for ${provider.name} (hidden input): `);
  if (!secretKey) {
    console.error('No API key entered. Exiting.');
    process.exit(1);
  }

  const adapter = ProviderRegistry.getAdapter(provider);
  const outDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'golden', provider.id);
  fs.mkdirSync(outDir, { recursive: true });

  const saveCase = (
    caseName: GoldenFixtureCase,
    res: { status: number; headers: Record<string, string>; bodyText: string }
  ) => {
    const sanitized = FixtureSanitizer.createSanitizedFixture({
      providerId: provider.id,
      caseName,
      httpStatus: res.status,
      headers: res.headers,
      rawBody: res.bodyText,
      secretKey,
    });
    const filePath = path.join(outDir, `${caseName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
    console.log(`  [saved] ${path.relative(process.cwd(), filePath)} (HTTP ${res.status})`);
  };

  // 1. Model list
  const listReq = adapter.buildListModels(provider);
  let targetModel = provider.models?.[0]?.id || 'gemini-2.5-flash';
  if (listReq) {
    console.log('1. Recording model-list...');
    const res = await executePreparedWithSecret(listReq, secretKey);
    saveCase('model-list', res);
    const parsedModels = adapter.parseModels(res.bodyText, provider);
    if (parsedModels.length > 0) {
      targetModel = parsedModels[0].id;
    }
  }

  // 2. Valid "Hi"
  console.log(`2. Recording valid-hi (model: ${targetModel})...`);
  const validHiReq = adapter.buildGenerate(provider, targetModel, 'Hi', 256, undefined, false);
  const validHiRes = await executePreparedWithSecret(validHiReq, secretKey);
  saveCase('valid-hi', validHiRes);

  // 3. Wrong key
  console.log('3. Recording wrong-key...');
  const wrongKeyRes = await executePreparedWithSecret(validHiReq, 'INVALID_KEY_FOR_FIXTURE_000000');
  saveCase('wrong-key', wrongKeyRes);

  // 4. Wrong model ID
  console.log('4. Recording wrong-model...');
  const wrongModelReq = adapter.buildGenerate(
    provider,
    'nonexistent-model-id-99999',
    'Hi',
    256,
    undefined,
    false
  );
  const wrongModelRes = await executePreparedWithSecret(wrongModelReq, secretKey);
  saveCase('wrong-model', wrongModelRes);

  console.log('\nDone! Please review `git diff tests/fixtures/golden/` before committing.');
  console.log('Note: Golden fixtures are sanitized contract test fixtures, never described as live verification.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Recorder failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
