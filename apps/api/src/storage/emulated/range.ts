import { VolumeStoreError } from '../types';

export interface ByteRange {
  start: number;
  /** inclusive */
  end: number;
}

function unsatisfiable(size: number): VolumeStoreError {
  return new VolumeStoreError(416, 'range_not_satisfiable', `range not satisfiable (size ${size})`);
}

/**
 * Parses one `Range` header the way Platinum's gateway does: a single range
 * (`bytes=a-b`, `bytes=a-`, `bytes=-n`); multi-ranges, `start >= size` and any
 * range on a 0-byte file are 416. Returns null when there is no header.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | null {
  if (header === undefined || header === null || header.trim() === '') return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) throw unsatisfiable(size);
  const [, a, b] = m;
  if (a === '' && b === '') throw unsatisfiable(size);
  if (size === 0) throw unsatisfiable(size);
  if (a === '') {
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0) throw unsatisfiable(size);
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start) || start >= size) throw unsatisfiable(size);
  let end = b === '' ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end) || end < start) throw unsatisfiable(size);
  if (end > size - 1) end = size - 1;
  return { start, end };
}
