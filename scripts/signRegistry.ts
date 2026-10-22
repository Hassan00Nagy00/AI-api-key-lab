/**
 * Maintainer CLI for Ed25519 Keypair Generation and Detached Canonical Registry Signing
 *
 * Usage:
 *   1. Generate keypair (never commit private key!):
 *      npx tsx scripts/signRegistry.ts --keygen ./offline-keys
 *
 *   2. Sign a registry JSON file:
 *      npx tsx scripts/signRegistry.ts --sign ./registry-v2.json --key ./offline-keys/registry-ed25519.priv.pem
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeJson, signCanonicalRegistryPayload, verifyDetachedEd25519Signature } from '../src/electron/signedRegistry';

function runCli(): void {
  const args = process.argv.slice(2);

  if (args.includes('--keygen')) {
    const outDirIdx = args.indexOf('--keygen') + 1;
    const outDir = path.resolve(args[outDirIdx] || './offline-keys');
    fs.mkdirSync(outDir, { recursive: true });

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const privPath = path.join(outDir, 'registry-ed25519.priv.pem');
    const pubPath = path.join(outDir, 'registry-ed25519.pub.pem');

    fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(pubPath, publicKey, { mode: 0o644 });

    console.log('Generated Ed25519 keypair:');
    console.log(`  Public Key (embed in src/electron/signedRegistry.ts): ${pubPath}`);
    console.log(`  Private Key (KEEP OFFLINE, NEVER COMMIT TO GIT):      ${privPath}`);
    return;
  }

  if (args.includes('--sign')) {
    const fileIdx = args.indexOf('--sign') + 1;
    const keyIdx = args.indexOf('--key') + 1;
    if (!args[fileIdx] || !args[keyIdx]) {
      console.error('Usage: npx tsx scripts/signRegistry.ts --sign <registry.json> --key <private-key.pem> [--pub <public-key.pem>]');
      process.exit(1);
    }

    const inputPath = path.resolve(args[fileIdx]);
    const privKeyPath = path.resolve(args[keyIdx]);

    const rawJson = fs.readFileSync(inputPath, 'utf8');
    const parsed = JSON.parse(rawJson);
    const canonical = canonicalizeJson(parsed);

    const privateKeyPem = fs.readFileSync(privKeyPath, 'utf8');
    const signatureBase64 = signCanonicalRegistryPayload(canonical, privateKeyPem);

    // Overwrite or write canonical JSON + detached .sig
    fs.writeFileSync(inputPath, canonical, 'utf8');
    fs.writeFileSync(`${inputPath}.sig`, signatureBase64 + '\n', 'utf8');

    if (args.includes('--pub')) {
      const pubIdx = args.indexOf('--pub') + 1;
      const pubKeyPem = fs.readFileSync(path.resolve(args[pubIdx]), 'utf8');
      const ok = verifyDetachedEd25519Signature(canonical, signatureBase64, pubKeyPem);
      if (!ok) {
        console.error('Self-verification failed!');
        process.exit(1);
      }
    }

    console.log(`Canonicalized and signed: ${inputPath}`);
    console.log(`Detached Ed25519 Signature: ${inputPath}.sig`);
    console.log(`Signature (base64): ${signatureBase64}`);
    return;
  }

  console.log('Commands:');
  console.log('  --keygen <outDir>                         Generate Ed25519 keypair');
  console.log('  --sign <registry.json> --key <priv.pem>   Canonicalize and sign registry JSON');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
