import { MAX_NAME_BYTES } from './constants';

const CONTROL = /[\x00-\x1f\x7f]/;
const encoder = new TextEncoder();

export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/**
 * Validates one file or folder name (a single path segment).
 * Returns a human-readable error, or null when the name is fine.
 */
export function validateName(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) return 'Name cannot be empty.';
  if (name.trim().length === 0) return 'Name cannot be only spaces.';
  if (name === '.' || name === '..') return `"${name}" is not a valid name.`;
  if (name.includes('/')) return 'Name cannot contain "/".';
  // Rejected rather than turned into a folder separator: one rule for rename, upload and the API.
  if (name.includes('\\')) return 'Name cannot contain "\\".';
  if (CONTROL.test(name)) return 'Name cannot contain control characters.';
  if (utf8Length(name) > MAX_NAME_BYTES) return `Name is too long (max ${MAX_NAME_BYTES} bytes).`;
  return null;
}

export function isValidName(name: string): boolean {
  return validateName(name) === null;
}
