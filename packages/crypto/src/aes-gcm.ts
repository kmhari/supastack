import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

/**
 * Load the master KEK from the environment. Throws if missing or malformed.
 * Called at API/worker startup; never silently falls back to plaintext.
 *
 * Accepts either 64 hex chars (`openssl rand -hex 32`) or 32 raw bytes
 * base64-decoded.
 */
export function loadMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.MASTER_KEY;
  if (!raw) throw new Error('MASTER_KEY env is missing');
  // hex
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // base64 (32 bytes -> 44 chars including padding)
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* fallthrough */
  }
  throw new Error('MASTER_KEY must be 64 hex chars or 32 base64-decoded bytes');
}

/** Encrypt plaintext bytes; output is `iv || ciphertext || tag`. */
export function encrypt(plaintext: Buffer | string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

/** Decrypt blob `iv || ciphertext || tag`. Throws on tag mismatch. */
export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  if (blob.length < IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** JSON convenience wrappers — used to encrypt the per-instance secrets blob. */
export function encryptJson(obj: unknown, key: Buffer): Buffer {
  return encrypt(JSON.stringify(obj), key);
}
export function decryptJson<T = unknown>(blob: Buffer, key: Buffer): T {
  return JSON.parse(decrypt(blob, key).toString('utf8')) as T;
}
