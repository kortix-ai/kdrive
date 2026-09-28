import { randomBytes } from 'node:crypto';
import { monotonicFactory } from 'ulid';

const next = monotonicFactory();

/** Our table ids: lowercase ULID (26 chars). */
export function newId(): string {
  return next().toLowerCase();
}

/** Share-link tokens: 24 random bytes, base64url (32 chars). */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}
