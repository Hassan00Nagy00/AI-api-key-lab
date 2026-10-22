import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptData, decryptData, maskKey } from '../services/crypto';

test('Security & Masking — correctly masks keys with prefix and last 4', () => {
  assert.equal(maskKey('sk-1234567890abcdef'), 'sk-••••cdef');
  assert.equal(maskKey('gsk_9876543210zyxw'), 'gsk_••••zyxw');
  assert.equal(maskKey('short12'), '••••12');
});

test('WebCrypto Backup Round-Trip — encrypts and decrypts with PBKDF2/AES-GCM', async () => {
  const secretData = JSON.stringify({ mySecret: 'super-secret-key-123' });
  const passphrase = 'CorrectHorseBatteryStaple123!';

  const envelope = await encryptData(secretData, passphrase);
  assert.equal(envelope.format, 'ai-api-key-lab-backup');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kdf.name, 'PBKDF2-HMAC-SHA256');
  assert.equal(envelope.cipher.name, 'AES-256-GCM');
  assert.equal(envelope.kdf.iterations >= 600000, true);

  const decrypted = await decryptData(envelope, passphrase);
  assert.equal(decrypted, secretData);
});

test('WebCrypto Backup Round-Trip — rejects wrong password with generic failure', async () => {
  const secretData = 'Confidential payload';
  const envelope = await encryptData(secretData, 'right-password-123');

  await assert.rejects(
    async () => {
      await decryptData(envelope, 'wrong-password-456');
    },
    {
      message: /Decryption failed: Incorrect passphrase or tampered backup/,
    }
  );
});

test('WebCrypto Backup Round-Trip — rejects tampered payload', async () => {
  const secretData = 'Confidential payload';
  const envelope = await encryptData(secretData, 'password-123');

  // Tamper with ciphertext payload
  const tamperedEnvelope = {
    ...envelope,
    payload: 'AAAA' + envelope.payload.slice(4),
  };

  await assert.rejects(
    async () => {
      await decryptData(tamperedEnvelope, 'password-123');
    },
    {
      message: /Decryption failed/,
    }
  );
});

test('Import & Backup Security — rejects __proto__ / prototype pollution payloads', async () => {
  const { ExportService } = await import('../services/exportService');
  assert.throws(
    () => {
      ExportService.importPlainConfig('{"__proto__":{"polluted":true}}');
    },
    {
      message: /Malicious attributes detected/,
    }
  );

  await assert.rejects(
    async () => {
      await ExportService.restoreEncryptedBackup('{"constructor":{"prototype":{}}}', 'pass12345');
    },
    {
      message: /Malicious attributes detected/,
    }
  );
});

