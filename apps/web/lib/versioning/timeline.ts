// Pure helpers for the Time Strip and Timeline Rail (DESIGN.md §6.4). No React.

import { format, isSameDay, isSameYear, subDays } from 'date-fns';
import { formatBytes, type TimelineEntry, type TimelineEntryKind } from '@volumes/shared';

const KiB = 1024;
const MiB = 1024 * KiB;

/** Tick height by |bytesDelta|: 0 → 4, < 64 KiB → 6, < 8 MiB → 10, < 256 MiB → 14, else 14 with a cap. */
export function tickHeight(bytesDelta: number): { h: number; cap: boolean } {
  const d = Math.abs(bytesDelta);
  if (d === 0) return { h: 4, cap: false };
  if (d < 64 * KiB) return { h: 6, cap: false };
  if (d < 8 * MiB) return { h: 10, cap: false };
  if (d < 256 * MiB) return { h: 14, cap: false };
  return { h: 14, cap: true };
}

/** Grows up for additions, hangs below for removals, centred for no size change. */
export function tickDirection(bytesDelta: number): 'up' | 'down' | 'center' {
  return bytesDelta > 0 ? 'up' : bytesDelta < 0 ? 'down' : 'center';
}

export const isRestoreKind = (k: TimelineEntryKind) => k === 'restore.file' || k === 'restore.folder' || k === 'restore.drive' || k === 'undo';

export type TimelineFilter = 'all' | 'uploads' | 'edits' | 'deletes' | 'restores' | 'checkpoints';

export const TIMELINE_FILTERS: { value: TimelineFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'uploads', label: 'Uploads' },
  { value: 'edits', label: 'Edits' },
  { value: 'deletes', label: 'Deletes' },
  { value: 'restores', label: 'Restores' },
  { value: 'checkpoints', label: '◆' },
];

export function matchesFilter(e: Pick<TimelineEntry, 'kind' | 'checkpoints'>, f: TimelineFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'uploads':
      return e.kind === 'upload' || e.kind === 'folder.create';
    case 'edits':
      return e.kind === 'rename' || e.kind === 'move' || e.kind === 'copy';
    case 'deletes':
      return e.kind === 'delete';
    case 'restores':
      return isRestoreKind(e.kind);
    case 'checkpoints':
      return e.checkpoints.length > 0;
  }
}

/** Day band label: TODAY, YESTERDAY, 14 SEP (14 SEP 2025 in another year). */
export function dayBandLabel(d: Date | string, now: Date = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, subDays(now, 1))) return 'Yesterday';
  return isSameYear(date, now) ? format(date, 'd MMM') : format(date, 'd MMM yyyy');
}

export function groupByDay<T extends { createdAt: string }>(items: T[], now: Date = new Date()): { label: string; key: string; items: T[] }[] {
  const out: { label: string; key: string; items: T[] }[] = [];
  for (const it of items) {
    const d = new Date(it.createdAt);
    const key = format(d, 'yyyy-MM-dd');
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, label: dayBandLabel(d, now), items: [it] });
  }
  return out;
}

/** Axis label for a day divider: "MON 14". */
export const axisDayLabel = (d: Date | string) => format(typeof d === 'string' ? new Date(d) : d, 'EEE d');

/** Time Strip timecode: "28 SEP 2026 · 10:41" (upper-cased by CSS). */
export const timecode = (d: Date | string) => format(typeof d === 'string' ? new Date(d) : d, 'd MMM yyyy · HH:mm');
/** Phones: "28 SEP 10:41", so the time survives a 132 px block. */
export const shortTimecode = (d: Date | string) => format(typeof d === 'string' ? new Date(d) : d, 'd MMM HH:mm');

/** Tooltip time: "16:40 · 14 SEP". */
export const tooltipTime = (d: Date | string) => format(typeof d === 'string' ? new Date(d) : d, 'HH:mm · d MMM');

export type Target = { commitId: string; createdAt: string } | 'now' | null;

/**
 * `,` (older) / `.` (newer) from the viewed entry (null = now). `entries` are newest first.
 * Stepping newer onto the head entry returns 'now'. Returns null when there is nowhere to go.
 */
export function stepEntry(entries: TimelineEntry[], current: string | null, dir: 'older' | 'newer'): Target {
  if (!entries.length) return null;
  const headIdx = Math.max(0, entries.findIndex((e) => e.isHead));
  const idx = current === null ? headIdx : entries.findIndex((e) => e.commitId === current);
  if (idx < 0) return null;
  const next = dir === 'older' ? idx + 1 : idx - 1;
  if (next < 0 || next >= entries.length) return current !== null && dir === 'newer' ? 'now' : null;
  if (next <= headIdx) return 'now';
  return { commitId: entries[next].commitId, createdAt: entries[next].createdAt };
}

/** `⇧,` / `⇧.`: the previous (older) / next (newer) entry with a checkpoint. */
export function jumpCheckpoint(entries: TimelineEntry[], current: string | null, dir: 'older' | 'newer'): Target {
  const headIdx = Math.max(0, entries.findIndex((e) => e.isHead));
  const idx = current === null ? headIdx : entries.findIndex((e) => e.commitId === current);
  if (idx < 0) return null;
  if (dir === 'older') {
    for (let i = idx + 1; i < entries.length; i++) if (entries[i].checkpoints.length) return { commitId: entries[i].commitId, createdAt: entries[i].createdAt };
    return null;
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (entries[i].checkpoints.length) return i <= headIdx ? 'now' : { commitId: entries[i].commitId, createdAt: entries[i].createdAt };
  }
  return null;
}

/** Slot width on the ordinal strip: clamp(8, trackWidth / n, 24). */
export function slotWidth(trackWidth: number, n: number): number {
  if (n <= 0) return 24;
  return Math.max(8, Math.min(24, trackWidth / n));
}

/** Index (in `xs`, ascending) of the tick nearest to `x`, or -1 when none is within `magnet` px. */
export function nearestTick(xs: number[], x: number, magnet = Infinity): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD <= magnet ? best : -1;
}

/** On release the playhead settles on the nearest tick at or before `x` (earlier in time); the oldest when none. */
export function releaseTick(xs: number[], x: number, magnet = 8): number {
  const snapped = nearestTick(xs, x, magnet);
  if (snapped >= 0) return snapped;
  let best = -1;
  for (let i = 0; i < xs.length; i++) if (xs[i] <= x) best = i;
  return best >= 0 ? best : xs.length ? 0 : -1;
}

/**
 * Index (oldest-first order) of the first entry within the last 7 days: the boundary between
 * "newest 50 + checkpoints" (older) and "every version" (newer). -1 when every entry is older.
 */
export function retentionBoundary(oldestFirst: { createdAt: string }[], now: number = Date.now()): number {
  const cut = now - 7 * 24 * 60 * 60 * 1000;
  return oldestFirst.findIndex((e) => new Date(e.createdAt).getTime() >= cut);
}

/** Older first: [a, b] ordered by createdAt (compare routes want a = older). */
export function orderPair<T extends { createdAt: string }>(x: T, y: T): [T, T] {
  return new Date(x.createdAt).getTime() <= new Date(y.createdAt).getTime() ? [x, y] : [y, x];
}

/** "+18.2 MiB", "−1.2 MiB", "±0 B". */
export function formatDelta(n: number): string {
  if (n === 0) return '±0 B';
  return n > 0 ? `+${formatBytes(n)}` : formatBytes(n);
}

/** Splits "4.2 MiB" into value and unit so units can render dimmer. */
export function splitUnit(s: string): { value: string; unit: string } {
  const i = s.lastIndexOf(' ');
  return i < 0 ? { value: s, unit: '' } : { value: s.slice(0, i), unit: s.slice(i + 1) };
}

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
