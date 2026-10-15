// Secrets at rest (the Stripe key and webhook secret an admin saves under Admin → Billing).
//
// AES-256-GCM under a key derived with HKDF-SHA256 from BETTER_AUTH_SECRET, so a database
// dump alone does not hand out the secrets. Sealed form: `v1:<iv b64url>:<ciphertext+tag b64url>`.
// When the auth secret changes, old boxes no longer open: `open` returns null and the caller
// treats the setting as not configured (the admin pastes it again), never as a crash.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../env';

const INFO = 'kdrive:settings:v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const keys = new Map<string, Buffer>();

function keyFor(secret: string): Buffer {
  let k = keys.get(secret);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32));
    keys.set(secret, k);
  }
  return k;
}

/** Encrypts `plain` for storage. `secret` defaults to the server's auth secret. */
export function seal(plain: string, secret: string = env.BETTER_AUTH_SECRET): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1:${iv.toString('base64url')}:${body.toString('base64url')}`;
}

/** The plain text of a sealed value, or null when it cannot be opened (malformed, tampered, other secret). */
export function open(box: string, secret: string = env.BETTER_AUTH_SECRET): string | null {
  const parts = box.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const body = Buffer.from(parts[2], 'base64url');
    if (iv.length !== IV_BYTES || body.length < TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), iv);
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
