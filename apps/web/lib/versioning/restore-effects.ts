// "What will this restore do?" lines for the restore dialog (DESIGN.md §6.8), computed from a
// drive compare between the target version (a) and now (b). Pure (no React).

import { isWithin, type DriveChange } from '@volumes/shared';

export interface EffectLine {
  mark: '~' | '+' | '−' | '→';
  text: string;
  count: number;
}

function things(files: number, dirs: number): string {
  const parts: string[] = [];
  if (files) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
  if (dirs) parts.push(`${dirs} ${dirs === 1 ? 'folder' : 'folders'}`);
  return parts.join(' and ');
}

/** Changes that touch `root` (the whole drive when root is '/' or undefined). */
export function changesUnder(changes: DriveChange[], root?: string): DriveChange[] {
  if (!root || root === '/') return changes;
  return changes.filter((c) => isWithin(root, c.path) || (!!c.fromPath && isWithin(root, c.fromPath)));
}

/**
 * Changes a → now, read backwards (restoring to a):
 * changed → goes back, removed (existed at a, gone now) → comes back, added (new since a) → removed,
 * moved → returns to where it was.
 */
export function restoreEffects(changes: DriveChange[], root?: string): EffectLine[] {
  const scoped = changesUnder(changes, root);
  const count = (op: DriveChange['op']) => {
    const xs = scoped.filter((c) => c.op === op);
    return { files: xs.filter((c) => c.type === 'file').length, dirs: xs.filter((c) => c.type === 'dir').length, n: xs.length };
  };
  const out: EffectLine[] = [];
  const changed = count('changed');
  if (changed.n) out.push({ mark: '~', count: changed.n, text: `${things(changed.files, changed.dirs)} ${changed.n === 1 ? 'goes' : 'go'} back to that version` });
  const removed = count('removed');
  if (removed.n) out.push({ mark: '+', count: removed.n, text: `${things(removed.files, removed.dirs)} ${removed.n === 1 ? 'comes' : 'come'} back` });
  const added = count('added');
  if (added.n) out.push({ mark: '−', count: added.n, text: `${things(added.files, added.dirs)} added after ${added.n === 1 ? 'is' : 'are'} removed` });
  const moved = count('moved');
  if (moved.n) out.push({ mark: '→', count: moved.n, text: `${things(moved.files, moved.dirs)} ${moved.n === 1 ? 'moves' : 'move'} back to where ${moved.n === 1 ? 'it was' : 'they were'}` });
  return out;
}
