import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { BLOCK_SIZE } from '@volumes/shared';

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** sha256 of a full 1 MiB block of zeros: never "missing", never stored. */
export const ZERO_BLOCK_SHA = sha256Hex(new Uint8Array(BLOCK_SIZE));

/** Atomic JSON write (tmp file + rename). */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Org-wide content-addressed block store: `<root>/blocks/<sha[0:2]>/<sha>`. */
export class BlockStore {
  private known = new Set<string>();
  constructor(private readonly root: string) {}

  private file(sha: string): string {
    return path.join(this.root, 'blocks', sha.slice(0, 2), sha);
  }

  async has(sha: string): Promise<boolean> {
    if (sha === ZERO_BLOCK_SHA) return true;
    if (this.known.has(sha)) return true;
    const ok = await exists(this.file(sha));
    if (ok) this.known.add(sha);
    return ok;
  }

  async put(sha: string, bytes: Uint8Array): Promise<void> {
    if (sha === ZERO_BLOCK_SHA || (await this.has(sha))) return;
    const file = this.file(sha);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
    this.known.add(sha);
  }

  async get(sha: string): Promise<Uint8Array> {
    if (sha === ZERO_BLOCK_SHA) return new Uint8Array(BLOCK_SIZE);
    return new Uint8Array(await readFile(this.file(sha)));
  }

  async missing(shas: Iterable<string>): Promise<string[]> {
    const out = new Set<string>();
    for (const s of shas) if (!(await this.has(s))) out.add(s);
    return [...out].sort();
  }
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Splits bytes into 1 MiB blocks and returns their sha256 hex digests. */
export function blocksOf(bytes: Uint8Array): { sha: string; bytes: Uint8Array }[] {
  const out: { sha: string; bytes: Uint8Array }[] = [];
  for (let off = 0; off < bytes.length; off += BLOCK_SIZE) {
    const chunk = bytes.subarray(off, Math.min(off + BLOCK_SIZE, bytes.length));
    out.push({ sha: sha256Hex(chunk), bytes: chunk });
  }
  return out;
}
