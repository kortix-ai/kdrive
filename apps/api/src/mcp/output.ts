// Output caps for tool results: UTF-8-safe windows and byte caps, so a page
// never splits a character. (Builder B fills the bodies.)
import { notImplemented } from '../lib/http';

export interface Capped {
  text: string;
  truncated: boolean;
  totalBytes: number;
  shownBytes: number;
}

/** Cap `text` to `max` bytes on a UTF-8 boundary. */
export function capBytes(_text: string, _max: number): Capped {
  throw notImplemented();
}

/** Snap [offset, offset + limit) to UTF-8 sequence boundaries. */
export function utf8Window(_bytes: Uint8Array, _offset: number, _limit: number): { start: number; end: number; startAdjusted: boolean } {
  throw notImplemented();
}
