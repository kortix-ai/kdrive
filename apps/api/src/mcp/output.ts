// Output caps for tool results: UTF-8-safe windows and byte caps, so a page
// never splits a character and a result never carries more than it says.

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export interface Capped {
  text: string;
  truncated: boolean;
  totalBytes: number;
  shownBytes: number;
}

/** A byte that continues a UTF-8 sequence (10xxxxxx). */
const isContinuation = (b: number) => (b & 0xc0) === 0x80;

/** Cap `text` to `max` bytes on a UTF-8 boundary (no marker appended: callers signpost it). */
export function capBytes(text: string, max: number): Capped {
  const bytes = enc.encode(text);
  if (bytes.length <= max) return { text, truncated: false, totalBytes: bytes.length, shownBytes: bytes.length };
  let end = Math.max(0, max);
  while (end > 0 && isContinuation(bytes[end])) end--;
  return { text: dec.decode(bytes.subarray(0, end)), truncated: true, totalBytes: bytes.length, shownBytes: end };
}

/**
 * Snap [offset, offset + limit) to UTF-8 sequence boundaries. `start` skips the
 * tail of a character split by `offset`; `end` never cuts a character (it can
 * only land mid-sequence at the very end of the buffer), so paging with
 * next_offset = end never splits or drops a character.
 */
export function utf8Window(bytes: Uint8Array, offset: number, limit: number): { start: number; end: number; startAdjusted: boolean } {
  const total = bytes.length;
  let start = Math.min(Math.max(offset, 0), total);
  const s0 = start;
  while (start < total && isContinuation(bytes[start])) start++;
  let end = Math.min(start + Math.max(limit, 0), total);
  while (end > start && end < total && isContinuation(bytes[end])) end--;
  return { start, end, startAdjusted: start !== s0 };
}

/** UTF-8 byte length of a string. */
export function utf8Bytes(s: string): number {
  return enc.encode(s).length;
}
