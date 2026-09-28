// File mutations that are one request = one ledger action: create folder,
// move / rename, copy, delete. Every one runs through `withPreparedAction`: the
// checks and the ledger rows (stats, block lists, sizes, quota) are computed
// under the workspace lock, so they describe exactly the state the mutation
// changes; then the intent is written and the commit finalises it.
import { basename, dirname, isWithin, type ActionSummary } from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import type { FileEntry, FileStat } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { exactBlockLists, withPreparedAction, type ActionCtx, type PathChange } from './ledger';
import { detachLiveLinks, moveLiveLinks } from './links';
import { assertQuota } from './quota';
import { listTree, statOrNull } from './tree';
import { logicalSize } from './upload-plan';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, then by name (natural, case-insensitive), then by exact name for a stable order. */
export function sortEntries<T extends Pick<FileEntry, 'name' | 'type'>>(entries: T[]): T[] {
  return entries.sort(
    (a, b) =>
      (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) ||
      collator.compare(a.name, b.name) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Recursive size of a folder (sum of file sizes) and its logical footprint. */
async function footprint(ws: WorkspaceCtx, st: FileStat): Promise<{ size: number; logical: number }> {
  if (st.type !== 'dir') return { size: st.size, logical: logicalSize(st.size) };
  const { entries } = await listTree(ws, st.path, st.commitId || undefined);
  let size = 0;
  let logical = 4096;
  for (const e of entries) {
    if (e.type === 'file') {
      size += e.size;
      logical += logicalSize(e.size);
    } else if (e.type === 'dir') logical += 4096;
  }
  return { size, logical };
}

async function mustStat(ws: WorkspaceCtx, path: string): Promise<FileStat> {
  const st = await statOrNull(ws, path);
  if (!st) throw new ApiError(404, 'path_not_found', `"${basename(path) || path}" does not exist.`, { path });
  return st;
}

/** Block list of a file from the ledger row that wrote its current version (never a same-size lookalike). */
async function knownBlocks(ws: WorkspaceCtx, st: FileStat): Promise<string[] | undefined> {
  if (st.type !== 'file') return undefined;
  return (await exactBlockLists(ws.id, [st])).get(st.path);
}

// ── create folder ──────────────────────────────────────────────────────────

/** Creates one empty folder (an upload plan with only `dirs`). An existing path is 409 `path_exists`. */
export async function createFolder(ctx: ActionCtx, path: string): Promise<ActionSummary> {
  if (path === '/') throw new ApiError(400, 'invalid_path', 'The root folder already exists.');
  const parent = dirname(path);
  const { action } = await withPreparedAction(
    ctx,
    async () => {
      const existing = await statOrNull(ctx.ws, path);
      if (existing) {
        throw new ApiError(409, 'path_exists', `"${basename(path)}" already exists.`, { paths: [path] });
      }
      // A parent that is a file cannot hold a folder.
      for (let up = dirname(path); up !== '/'; up = dirname(up)) {
        const st = await statOrNull(ctx.ws, up);
        if (!st) continue;
        if (st.type !== 'dir') throw new ApiError(409, 'not_a_directory', `"${basename(up)}" is a file, so it cannot hold a folder.`, { path: up });
        break;
      }
      return {
        spec: {
          kind: 'folder.create',
          summary: `Created folder ${basename(path)}${parent === '/' ? '' : ` in ${parent}`}`,
          paths: [{ op: 'added', path, entryType: 'dir' }],
        },
        data: undefined,
      };
    },
    async (rec) => {
      const store = getStore();
      const plan = await store.planUpload(ctx.ws.volumeId, { files: [], dirs: [path], overwrite: false });
      try {
        await rec.commit(await store.commitUpload(ctx.ws.volumeId, plan.uploadId));
      } finally {
        // After a commit the plan is gone; after a failure it still holds its slot until it expires.
        store.releaseUpload(plan.uploadId);
      }
    },
  );
  return action;
}

// ── move / rename / copy ───────────────────────────────────────────────────

export interface TransferItem {
  from: string;
  to: string;
}

interface CheckedItem extends TransferItem {
  st: FileStat;
  dest: FileStat | null;
}

async function checkTransfer(ws: WorkspaceCtx, items: TransferItem[], overwrite: boolean, verb: 'move' | 'copy'): Promise<CheckedItem[]> {
  const out: CheckedItem[] = [];
  const targets = new Set<string>();
  const froms = items.map((i) => i.from);
  for (const it of items) {
    if (it.from === '/') throw new ApiError(400, 'bad_request', `The root folder cannot be ${verb === 'move' ? 'moved' : 'copied'}.`);
    if (it.to === '/') throw new ApiError(400, 'invalid_path', 'The destination must be a file or folder path, not the root.');
    if (verb === 'move' && it.from === it.to) continue; // nothing to do
    if (targets.has(it.to)) throw new ApiError(400, 'bad_request', `Two items would end up at "${it.to}".`, { path: it.to });
    targets.add(it.to);
    if (froms.some((f) => f !== it.from && isWithin(f, it.from))) {
      throw new ApiError(400, 'bad_request', `"${it.from}" is inside another selected folder.`, { path: it.from });
    }
    const st = await mustStat(ws, it.from);
    if (st.type === 'dir' && isWithin(it.from, it.to)) {
      throw new ApiError(400, 'bad_request', `A folder cannot be ${verb === 'move' ? 'moved' : 'copied'} into itself.`, { path: it.to });
    }
    const dest = it.from === it.to ? st : await statOrNull(ws, it.to);
    out.push({ ...it, st, dest });
  }
  if (!overwrite) {
    const clash = out.filter((i) => i.dest).map((i) => i.to);
    if (clash.length) {
      throw new ApiError(
        409,
        'path_exists',
        clash.length === 1 ? `"${basename(clash[0])}" already exists there.` : `${clash.length} items already exist there.`,
        { paths: clash },
      );
    }
  } else {
    for (const i of out) {
      if (i.dest && i.dest.type !== i.st.type) {
        throw new ApiError(
          409,
          i.dest.type === 'dir' ? 'not_a_file' : 'not_a_directory',
          `"${basename(i.to)}" exists as a ${i.dest.type === 'dir' ? 'folder' : 'file'}; it cannot be replaced by a ${i.st.type === 'dir' ? 'folder' : 'file'}.`,
          { path: i.to },
        );
      }
    }
  }
  return out;
}

/** "Moved a.txt to /Docs", "Moved 3 items to /Docs", "Copied a.txt as a copy.txt"; the root reads as the workspace name. */
export function transferSummary(verb: 'Moved' | 'Copied', items: TransferItem[], rootName: string): string {
  const label = (dir: string) => (dir === '/' ? rootName : dir);
  const dests = new Set(items.map((i) => dirname(i.to)));
  if (items.length === 1) {
    const i = items[0];
    if (dirname(i.from) === dirname(i.to)) return `${verb} ${basename(i.from)} as ${basename(i.to)}`;
    const renamed = basename(i.from) !== basename(i.to) ? ` as ${basename(i.to)}` : '';
    return `${verb} ${basename(i.from)} to ${label(dirname(i.to))}${renamed}`;
  }
  if (dests.size === 1) return `${verb} ${plural(items.length, 'item')} to ${label([...dests][0])}`;
  return `${verb} ${plural(items.length, 'item')}`;
}

/** Move or rename (one item within the same folder = rename). One action, one Platinum call per item. */
export async function movePaths(ctx: ActionCtx, items: TransferItem[], overwrite = false): Promise<ActionSummary> {
  const { action } = await withPreparedAction(
    ctx,
    async () => {
      const checked = await checkTransfer(ctx.ws, items, overwrite, 'move');
      if (!checked.length) throw new ApiError(400, 'bad_request', 'Nothing to move: every item is already there.');
      const isRename = checked.length === 1 && dirname(checked[0].from) === dirname(checked[0].to);
      const paths: PathChange[] = [];
      for (const i of checked) {
        const fp = i.st.type === 'dir' ? await footprint(ctx.ws, i.st) : { size: i.st.size };
        paths.push({
          op: 'moved',
          path: i.to,
          fromPath: i.from,
          entryType: i.st.type === 'dir' ? 'dir' : 'file',
          size: fp.size,
          prevSize: i.dest && i.dest.type === 'file' ? i.dest.size : undefined,
          blockHashes: await knownBlocks(ctx.ws, i.st),
          mtime: i.st.mtime,
        });
      }
      const summary = isRename ? `Renamed ${basename(checked[0].from)} to ${basename(checked[0].to)}` : transferSummary('Moved', checked, ctx.ws.name);
      return { spec: { kind: isRename ? 'rename' : 'move', summary, paths }, data: checked };
    },
    async (rec, checked) => {
      const store = getStore();
      for (const i of checked) {
        await rec.commit(await store.move(ctx.ws.volumeId, i.from, i.to, { overwrite }));
        // Live links follow the item; links to an item the move replaced are detached.
        if (i.dest) await detachLiveLinks(ctx.ws.id, i.to, rec.actionId);
        await moveLiveLinks(ctx.ws.id, i.from, i.to);
      }
    },
  );
  return action;
}

/** Copy files or folders (recursive). The quota is checked for the added bytes first, under the lock. */
export async function copyPaths(ctx: ActionCtx, items: TransferItem[], overwrite = false): Promise<ActionSummary> {
  for (const it of items) {
    if (it.from === it.to) throw new ApiError(409, 'path_exists', `"${basename(it.to)}" already exists there.`, { paths: [it.to] });
  }
  const { action } = await withPreparedAction(
    ctx,
    async () => {
      const checked = await checkTransfer(ctx.ws, items, overwrite, 'copy');
      const paths: PathChange[] = [];
      let added = 0;
      for (const i of checked) {
        const fp = await footprint(ctx.ws, i.st);
        let replacedLogical = 0;
        if (i.dest) replacedLogical = (await footprint(ctx.ws, i.dest)).logical;
        added += fp.logical - replacedLogical;
        paths.push({
          op: 'copied',
          path: i.to,
          fromPath: i.from,
          entryType: i.st.type === 'dir' ? 'dir' : 'file',
          size: fp.size,
          prevSize: i.dest && i.dest.type === 'file' ? i.dest.size : undefined,
          blockHashes: await knownBlocks(ctx.ws, i.st),
          mtime: i.st.mtime,
        });
      }
      await assertQuota(ctx.userId, added);
      return { spec: { kind: 'copy', summary: transferSummary('Copied', checked, ctx.ws.name), paths }, data: checked };
    },
    async (rec, checked) => {
      const store = getStore();
      for (const i of checked) {
        await rec.commit(await store.copy(ctx.ws.volumeId, i.from, i.to, { recursive: i.st.type === 'dir', overwrite }));
        if (i.dest) await detachLiveLinks(ctx.ws.id, i.to, rec.actionId);
      }
    },
  );
  return action;
}

// ── delete ─────────────────────────────────────────────────────────────────

/** Deletes files and folders (recursive). One ledger row per top-level path; undo = restore to the base commit. */
export async function deletePaths(ctx: ActionCtx, paths: string[]): Promise<ActionSummary> {
  const uniq = [...new Set(paths)];
  if (uniq.includes('/')) throw new ApiError(400, 'bad_request', 'The root folder cannot be deleted.');
  // A folder already covers everything inside it.
  const tops = uniq.filter((p) => !uniq.some((o) => o !== p && isWithin(o, p)));
  const { action } = await withPreparedAction(
    ctx,
    async () => {
      const rows: PathChange[] = [];
      const stats: FileStat[] = [];
      for (const p of tops) {
        const st = await mustStat(ctx.ws, p);
        stats.push(st);
        const fp = await footprint(ctx.ws, st);
        rows.push({
          op: 'deleted',
          path: p,
          entryType: st.type === 'dir' ? 'dir' : 'file',
          size: fp.size,
          blockHashes: await knownBlocks(ctx.ws, st),
          mtime: st.mtime,
        });
      }
      const summary =
        tops.length === 1
          ? `Deleted ${basename(tops[0])}`
          : stats.every((s) => s.type === 'dir')
            ? `Deleted ${plural(tops.length, 'folder')}`
            : stats.every((s) => s.type !== 'dir')
              ? `Deleted ${plural(tops.length, 'file')}`
              : `Deleted ${plural(tops.length, 'item')}`;
      return { spec: { kind: 'delete', summary, paths: rows }, data: undefined };
    },
    async (rec) => {
      const store = getStore();
      for (const p of tops) {
        await rec.commit(await store.remove(ctx.ws.volumeId, p, { recursive: true }));
        // Whatever is created at this path later is not what was shared.
        await detachLiveLinks(ctx.ws.id, p, rec.actionId);
      }
    },
  );
  return action;
}
