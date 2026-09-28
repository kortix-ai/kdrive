// Which blocks a user has already proven they hold.
//
// Platinum dedups blocks across the whole org, and every user shares one org,
// so the store's `missing` list answers "does ANYONE store this content?".
// Handing that answer to a browser would let one user test whether another
// user stores a given file. Instead, a block is skipped only when this user's
// own history already holds it: a committed ledger row (upload, restore, move,
// copy or delete) of one of their workspaces lists it. Every other block is
// reported missing and must be sent; the PUT is hash-checked and is a no-op
// for the store when it already has the bytes, so dedup still saves storage.
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

const CHUNK = 5000;

/** The subset of `shas` that appears in a committed ledger row of one of `userId`'s workspaces. */
export async function provenBlocks(userId: string, shas: Iterable<string>): Promise<Set<string>> {
  const want = [...new Set(shas)];
  const out = new Set<string>();
  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK);
    const rows = await db.execute<{ sha: string }>(sql`
      SELECT DISTINCT b.sha
      FROM action_paths ap
      JOIN actions a ON a.id = ap.action_id AND a.status = 'committed'
      JOIN workspaces w ON w.id = ap.workspace_id AND w.user_id = ${userId}
      CROSS JOIN LATERAL unnest(ap.block_hashes) AS b(sha)
      WHERE ap.block_hashes && ${sql.param(chunk)}::text[]
        AND b.sha = ANY(${sql.param(chunk)}::text[])`);
    for (const r of rows as unknown as { sha: string }[]) out.add(r.sha);
  }
  return out;
}

/**
 * What a browser must send for a plan: the store's own `missing`, plus every
 * planned block this user has not proven they hold. Sorted, unique.
 */
export async function missingForUser(userId: string, planned: Iterable<string>, storeMissing: string[]): Promise<string[]> {
  const all = new Set(planned);
  const held = await provenBlocks(userId, all);
  const out = new Set(storeMissing);
  for (const sha of all) if (!held.has(sha)) out.add(sha);
  return [...out].sort();
}
