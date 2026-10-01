// Turns a browser upload plan into a Platinum plan: validates it, resolves
// conflicts against head (ask / keep-both / replace), and builds the ledger rows.
import type { z } from 'zod';
import {
  BLOCK_SIZE,
  MAX_PLAN_BLOCKS,
  MAX_PLAN_FILES,
  basename,
  dirname,
  joinPath,
  nextFreeName,
  normalizePath,
  splitPath,
  validateName,
  type UploadPlanRequest,
} from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import { isStoreError, type FileEntry, type UploadPlan } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { logicalSize, planGrowth } from './footprint';
import type { PathChange } from './ledger';
import { listDir, statOrNull } from './tree';

export type ResolvedUploadPlan = {
  plan: UploadPlan;
  renamed: { from: string; to: string }[];
  changes: PathChange[];
  totalBytes: number;
  /**
   * Growth of the volume's logicalBytes at the head the plan was resolved on
   * (new files minus the files they replace, plus every folder created, missing
   * parents included), for the quota check.
   */
  addedBytes: number;
  /** Final paths of files that replace an existing file. */
  replaced: string[];
};

export { logicalSize };

const SHA = /^[0-9a-f]{64}$/;

/** Re-validates one path (already normalised by the schema): every segment passes validateName, and it is not the root. */
function checkPath(p: string, what: string): string {
  const n = normalizePath(p);
  if (n === '/') throw new ApiError(400, 'invalid_path', `The ${what} path cannot be the root folder.`);
  for (const seg of splitPath(n)) {
    const err = validateName(seg);
    if (err) throw new ApiError(400, 'invalid_name', err, { path: n });
  }
  return n;
}

/**
 * The entries of `dir` at head, keyed by name. A missing folder has none. A
 * folder whose path (or an ancestor) is a file cannot receive children: 409.
 */
async function childrenAtHead(ws: WorkspaceCtx, dir: string, at?: string): Promise<Map<string, FileEntry>> {
  try {
    const { entries } = await listDir(ws, dir, at);
    return new Map(entries.map((e) => [e.name || basename(e.path), e]));
  } catch (e) {
    if (isStoreError(e, 'not_a_directory')) {
      throw new ApiError(409, 'not_a_directory', `"${basename(dir)}" is a file, so it cannot hold other items.`, { path: dir });
    }
    if (!isStoreError(e, 'path_not_found')) throw e;
    // Missing folder: make sure no ancestor is a file (the commit would fail later).
    let up = dirname(dir);
    for (;;) {
      const st = await statOrNull(ws, up, at);
      if (st) {
        if (st.type !== 'dir') {
          throw new ApiError(409, 'not_a_directory', `"${basename(up)}" is a file, so it cannot hold other items.`, { path: up });
        }
        break;
      }
      if (up === '/') break;
      up = dirname(up);
    }
    return new Map();
  }
}

/**
 * Validates a browser plan, resolves conflicts (ask / keep-both / replace)
 * against head, or against commit `at` (the head the caller read) when given.
 */
export async function resolveUploadPlan(ws: WorkspaceCtx, req: z.output<typeof UploadPlanRequest>, at?: string): Promise<ResolvedUploadPlan> {
  const files = req.files ?? [];
  const dirsIn = req.dirs ?? [];
  if (files.length === 0 && dirsIn.length === 0) throw new ApiError(400, 'bad_request', 'A plan needs files or folders.');
  if (files.length > MAX_PLAN_FILES) throw new ApiError(400, 'bad_request', `An upload can hold at most ${MAX_PLAN_FILES} files.`);

  // ── validate shape ─────────────────────────────────────────────────────────
  let blockCount = 0;
  let totalBytes = 0;
  const filePaths = new Set<string>();
  const normFiles = files.map((f) => {
    const path = checkPath(f.path, 'file');
    if (filePaths.has(path)) throw new ApiError(400, 'bad_request', `"${path}" appears twice in this upload.`, { path });
    filePaths.add(path);
    if (!Number.isSafeInteger(f.size) || f.size < 0) throw new ApiError(400, 'bad_request', `Bad size for "${path}".`, { path });
    const expected = Math.ceil(f.size / BLOCK_SIZE);
    if (f.blocks.length !== expected) {
      throw new ApiError(400, 'bad_request', `"${path}" needs ${expected} blocks for ${f.size} bytes, got ${f.blocks.length}.`, { path });
    }
    for (const b of f.blocks) if (!SHA.test(b)) throw new ApiError(400, 'bad_request', `Bad block hash in "${path}".`, { path });
    blockCount += expected;
    totalBytes += f.size;
    return { path, size: f.size, blocks: f.blocks, mtime: f.mtime };
  });
  if (blockCount > MAX_PLAN_BLOCKS) throw new ApiError(400, 'bad_request', `An upload can hold at most ${MAX_PLAN_BLOCKS} blocks.`);

  const dirSet = new Set<string>();
  for (const d of dirsIn) {
    const p = checkPath(d, 'folder');
    if (filePaths.has(p)) throw new ApiError(400, 'bad_request', `"${p}" is both a file and a folder in this upload.`, { path: p });
    dirSet.add(p);
  }
  // A file cannot also be a folder that holds other planned items.
  for (const p of [...filePaths, ...dirSet]) {
    for (let up = dirname(p); up !== '/'; up = dirname(up)) {
      if (filePaths.has(up)) throw new ApiError(400, 'bad_request', `"${up}" is a file in this upload, so it cannot hold "${p}".`, { path: up });
    }
  }

  // ── conflicts against head ────────────────────────────────────────────────
  const parents = new Set<string>();
  for (const f of normFiles) parents.add(dirname(f.path));
  for (const d of dirSet) parents.add(dirname(d));
  const head = new Map<string, Map<string, FileEntry>>();
  for (const p of parents) head.set(p, await childrenAtHead(ws, p, at));

  const conflicts: string[] = [];
  for (const f of normFiles) {
    const cur = head.get(dirname(f.path))!.get(basename(f.path));
    if (cur) conflicts.push(f.path);
  }
  for (const d of dirSet) {
    const cur = head.get(dirname(d))!.get(basename(d));
    if (cur && cur.type !== 'dir') {
      throw new ApiError(409, 'not_a_directory', `"${basename(d)}" already exists as a file.`, { path: d });
    }
  }

  const mode = req.conflict ?? 'ask';
  if (conflicts.length && mode === 'ask') {
    throw new ApiError(
      409,
      'conflict',
      conflicts.length === 1 ? `"${basename(conflicts[0])}" already exists.` : `${conflicts.length} items already exist.`,
      { conflicts },
    );
  }

  const renamed: { from: string; to: string }[] = [];
  const replaced: string[] = [];
  const finalFiles = normFiles.map((f) => ({ ...f }));

  if (conflicts.length && mode === 'keep-both') {
    // Names taken per folder: what exists at head plus everything this plan puts there.
    const taken = new Map<string, Set<string>>();
    const takenIn = (dir: string) => {
      let s = taken.get(dir);
      if (!s) {
        s = new Set(head.get(dir)?.keys() ?? []);
        taken.set(dir, s);
      }
      return s;
    };
    for (const f of normFiles) takenIn(dirname(f.path)).add(basename(f.path));
    for (const d of dirSet) takenIn(dirname(d)).add(basename(d));
    const conflictSet = new Set(conflicts);
    for (const f of finalFiles) {
      if (!conflictSet.has(f.path)) continue;
      const dir = dirname(f.path);
      const set = takenIn(dir);
      const name = nextFreeName(basename(f.path), set);
      set.add(name);
      const to = joinPath(dir, name);
      renamed.push({ from: f.path, to });
      f.path = to;
    }
  } else if (conflicts.length && mode === 'replace') {
    for (const p of conflicts) {
      const cur = head.get(dirname(p))!.get(basename(p))!;
      if (cur.type === 'dir') {
        throw new ApiError(409, 'not_a_file', `"${basename(p)}" is a folder, so a file cannot replace it.`, { path: p });
      }
      replaced.push(p);
    }
  }

  // ── ledger rows + quota estimate ──────────────────────────────────────────
  const changes: PathChange[] = [];
  const replacedSet = new Set(replaced);
  for (const f of finalFiles) {
    // Renamed (keep-both) files never replace anything; replaced files keep their path.
    const cur = replacedSet.has(f.path) ? head.get(dirname(f.path))!.get(basename(f.path)) : undefined;
    changes.push({
      op: cur ? 'changed' : 'added',
      path: f.path,
      entryType: 'file',
      size: f.size,
      prevSize: cur ? cur.size : undefined,
      blockHashes: f.blocks,
      mtime: f.mtime,
    });
  }
  for (const d of [...dirSet].sort()) {
    const cur = head.get(dirname(d))!.get(basename(d));
    if (cur) continue; // already there: nothing changes
    changes.push({ op: 'added', path: d, entryType: 'dir' });
  }
  // Measured on the tree the listings above were read at, missing parents included.
  const base = at ?? (await getStore().getVolume(ws.volumeId)).headCommitId;
  const addedBytes = await planGrowth(ws, base, finalFiles, [...dirSet], head);

  return {
    plan: {
      files: finalFiles.map((f) => ({ path: f.path, size: f.size, blocks: f.blocks, ...(f.mtime !== undefined ? { mtime: f.mtime } : {}) })),
      dirs: [...dirSet].sort(),
      overwrite: mode === 'replace',
    },
    renamed,
    changes,
    totalBytes,
    addedBytes,
    replaced,
  };
}
