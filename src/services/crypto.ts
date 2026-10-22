import { EncryptedBackupEnvelope } from '../types/backup';

/**
 * Security and WebCrypto utilities
 * PBKDF2 (600,000 iterations) + AES-256-GCM
 */

const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive non-extractable AES-256-GCM key from passphrase using PBKDF2
 */
async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBuffer = salt instanceof Uint8Array ? salt : new Uint8Array(salt);

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Mask an API key, showing at most 4 prefix characters and the last 4 characters.
 * Guarantees no substring of length >= 6 of the raw secret ever appears in maskedKey (§13A Canary rule).
 * Example: sk-••••7F3A or gsk_••••A1B2
 */
export function maskKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••' + trimmed.slice(-2);
  }

  // Extract a short prefix (at most 4 chars) so no >= 6 char substring of the secret is exposed
  const prefixMatch = trimmed.match(/^([a-zA-Z0-9]{2,3}[_\-])/);
  const prefix = prefixMatch ? prefixMatch[1] : trimmed.slice(0, 3);
  const last4 = trimmed.slice(-4);
  return `${prefix}••••${last4}`;
}

/**
 * Generate a salted SHA-256 fingerprint for duplicate detection without exposing the key.
 */
export async function generateKeyFingerprint(key: string, salt: string = 'ai-api-key-lab-salt-v1'): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${key.trim()}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/**
 * Encrypt plaintext data using AES-256-GCM and user passphrase
 */
export async function encryptData(plaintext: string, passphrase: string): Promise<EncryptedBackupEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await deriveAesKey(passphrase, salt);

  const createdAt = new Date().toISOString();
  // Additional Authenticated Data (AAD) binding format, version, createdAt, algorithms
  const aadString = `ai-api-key-lab-backup:1:${createdAt}:PBKDF2-HMAC-SHA256:AES-256-GCM`;
  const enc = new TextEncoder();
  const additionalData = enc.encode(aadString);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData,
      tagLength: 128,
    },
    key,
    enc.encode(plaintext)
  );

  return {
    format: 'ai-api-key-lab-backup',
    version: 1,
    createdAt,
    encrypted: true,
    kdf: {
      name: 'PBKDF2-HMAC-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: arrayBufferToBase64(salt),
    },
    cipher: {
      name: 'AES-256-GCM',
      iv: arrayBufferToBase64(iv),
      tagLength: 128,
    },
    payload: arrayBufferToBase64(ciphertext),
  };
}

/**
 * Decrypt an EncryptedBackupEnvelope with user passphrase
 */
export async function decryptData(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<string> {
  if (envelope.format !== 'ai-api-key-lab-backup' || envelope.version !== 1) {
    throw new Error('Unsupported or unrecognized backup format');
  }

  if (envelope.kdf.name !== 'PBKDF2-HMAC-SHA256' || envelope.cipher.name !== 'AES-256-GCM') {
    throw new Error('Unsupported cryptographic parameters in backup');
  }

  const salt = new Uint8Array(base64ToArrayBuffer(envelope.kdf.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(envelope.cipher.iv));
  const ciphertext = base64ToArrayBuffer(envelope.payload);

  const key = await deriveAesKey(passphrase, salt);

  const aadString = `${envelope.format}:${envelope.version}:${envelope.createdAt}:${envelope.kdf.name}:${envelope.cipher.name}`;
  const enc = new TextEncoder();
  const additionalData = enc.encode(aadString);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData,
        tagLength: 128,
      },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch {
    throw new Error('Decryption failed: Incorrect passphrase or tampered backup');
  }
}
