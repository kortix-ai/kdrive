// Port of Platinum's retention (apps/api/src/vol/gc.ts computeRetained),
// kept verbatim so the emulator thins history exactly like the real thing.

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;
export const BUCKET_MS = 10 * 60_000;
export const KEEP_LAST = 50;
export const RETENTION_DAYS = 7;
export const TRASH_MS = 48 * HOUR;
export const NEVER_THINNED = new Set(['api', 'restore', 'fork']);

export interface RetentionCommit {
  id: string;
  seq: number | null;
  onHead: boolean;
  kind: string;
  /** ms */
  createdAt: number;
}

export function computeRetained(
  commits: RetentionCommit[],
  pinned: Set<string>,
  now: number,
  opts: { keepLast: number; days: number } = { keepLast: KEEP_LAST, days: RETENTION_DAYS },
): Set<string> {
  const keep = new Set<string>();
  const horizon = now - opts.days * DAY;
  const head = commits.filter((c) => c.onHead && c.seq !== null).sort((a, b) => Number(b.seq) - Number(a.seq));
  for (const c of head.slice(0, opts.keepLast)) keep.add(c.id);
  const bucketTaken = new Set<number>();
  for (const c of head) {
    if (c.createdAt < horizon) continue;
    if (now - c.createdAt <= HOUR || NEVER_THINNED.has(c.kind)) {
      keep.add(c.id);
      continue;
    }
    // Newest per 10-minute bucket: `head` is newest-first, so the first seen wins.
    const bucket = Math.floor(c.createdAt / BUCKET_MS);
    if (!bucketTaken.has(bucket)) {
      bucketTaken.add(bucket);
      keep.add(c.id);
    }
  }
  for (const c of commits) {
    if (!c.onHead && c.createdAt >= horizon) keep.add(c.id);
    if (pinned.has(c.id)) keep.add(c.id);
  }
  return keep;
}
