// Block hashing shared by the Web Worker (hash.worker.ts), the main-thread
// fallback and tests. Kept free of the shared package on purpose, so the
// worker bundle stays tiny (no zod). hash-core.test.ts pins BLOCK to BLOCK_SIZE.

/** Platinum block size (1 MiB). Must equal `BLOCK_SIZE` from @volumes/shared. */
export const BLOCK = 1_048_576;

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  return toHex(await crypto.subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>));
}

/** `ceil(size / 1 MiB)`; a 0-byte file has no blocks. */
export function blockCount(size: number): number {
  return Math.ceil(size / BLOCK);
}

export class HashAbortedError extends Error {
  constructor() {
    super('Hashing was cancelled.');
    this.name = 'AbortError';
  }
}

/**
 * SHA-256 of every 1 MiB slice of `blob` (the last slice is short, never padded).
 * `onProgress` receives the cumulative number of bytes hashed after each block.
 */
export async function hashBlob(blob: Blob, onProgress?: (hashed: number) => void, signal?: { aborted: boolean }): Promise<string[]> {
  const out: string[] = [];
  for (let off = 0; off < blob.size; off += BLOCK) {
    if (signal?.aborted) throw new HashAbortedError();
    const end = Math.min(off + BLOCK, blob.size);
    const buf = await blob.slice(off, end).arrayBuffer();
    out.push(await sha256Hex(buf));
    onProgress?.(end);
  }
  return out;
}
