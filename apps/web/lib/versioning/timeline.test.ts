import { describe, expect, test } from 'bun:test';
import type { TimelineEntry } from '@volumes/shared';
import {
  axisDayLabel,
  dayBandLabel,
  dotSize,
  friendlyWhen,
  formatDelta,
  groupByDay,
  jumpCheckpoint,
  matchesFilter,
  nearestTick,
  orderPair,
  releaseTick,
  retentionBoundary,
  slotWidth,
  splitUnit,
  stepEntry,
} from './timeline';

const entry = (i: number, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: `e${i}`,
  commitId: `vc_${i}`,
  createdAt: new Date(Date.UTC(2026, 8, 20, 12, 0) - i * 60_000).toISOString(),
  kind: 'upload',
  summary: `entry ${i}`,
  itemCount: 1,
  bytesDelta: 0,
  actor: null,
  checkpoints: [],
  mergedCount: 0,
  isHead: i === 0,
  undoable: true,
  actionId: `a${i}`,
  paths: [],
  ...over,
});

describe('timeline helpers', () => {
  test('dot size buckets', () => {
    expect(dotSize(0)).toBe(6);
    expect(dotSize(1000)).toBe(6);
    expect(dotSize(-2 * 1024 * 1024)).toBe(8);
    expect(dotSize(100 * 1024 * 1024)).toBe(10);
  });

  test('friendly times', () => {
    const now = new Date(2026, 8, 28, 12, 0);
    expect(friendlyWhen(new Date(2026, 8, 28, 11, 59, 40), now)).toBe('Just now');
    expect(friendlyWhen(new Date(2026, 8, 28, 11, 56), now)).toBe('4 min ago');
    expect(friendlyWhen(new Date(2026, 8, 28, 10, 0), now)).toBe('2 hours ago');
    expect(friendlyWhen(new Date(2026, 8, 28, 1, 12), now)).toBe('Today 01:12');
    expect(friendlyWhen(new Date(2026, 8, 27, 18, 2), now)).toBe('Yesterday, 18:02');
    expect(friendlyWhen(new Date(2026, 8, 14, 16, 40), now)).toBe('Mon 14 Sep 16:40');
    expect(axisDayLabel(new Date(2026, 8, 28, 1), now)).toBe('Today');
    expect(axisDayLabel(new Date(2026, 8, 3, 1), now)).toBe('Sep 3');
  });

  test('filters', () => {
    expect(matchesFilter(entry(1, { kind: 'folder.create' }), 'uploads')).toBe(true);
    expect(matchesFilter(entry(1, { kind: 'rename' }), 'edits')).toBe(true);
    expect(matchesFilter(entry(1, { kind: 'undo' }), 'restores')).toBe(true);
    expect(matchesFilter(entry(1, { kind: 'delete' }), 'uploads')).toBe(false);
    expect(matchesFilter(entry(1, { checkpoints: [{ id: 'c', name: 'v1' }] }), 'checkpoints')).toBe(true);
    expect(matchesFilter(entry(1), 'all')).toBe(true);
  });

  test('day bands', () => {
    const now = new Date(2026, 8, 28, 10, 0);
    expect(dayBandLabel(new Date(2026, 8, 28, 1, 0), now)).toBe('Today');
    expect(dayBandLabel(new Date(2026, 8, 27, 23, 0), now)).toBe('Yesterday');
    expect(dayBandLabel(new Date(2026, 8, 14, 16, 40), now)).toBe('14 Sep');
    expect(dayBandLabel(new Date(2025, 8, 14, 16, 40), now)).toBe('14 Sep 2025');
    const groups = groupByDay(
      [
        { createdAt: new Date(2026, 8, 28, 9).toISOString() },
        { createdAt: new Date(2026, 8, 28, 8).toISOString() },
        { createdAt: new Date(2026, 8, 14, 8).toISOString() },
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Today', 2],
      ['14 Sep', 1],
    ]);
  });

  test('step older / newer', () => {
    const es = [entry(0), entry(1), entry(2)];
    expect(stepEntry(es, null, 'older')).toEqual({ commitId: 'vc_1', createdAt: es[1].createdAt });
    expect(stepEntry(es, 'vc_1', 'older')).toEqual({ commitId: 'vc_2', createdAt: es[2].createdAt });
    expect(stepEntry(es, 'vc_2', 'older')).toBeNull();
    expect(stepEntry(es, 'vc_1', 'newer')).toBe('now');
    expect(stepEntry(es, null, 'newer')).toBeNull();
    expect(stepEntry([], null, 'older')).toBeNull();
  });

  test('jump between checkpoints', () => {
    const es = [entry(0, { checkpoints: [{ id: 'h', name: 'now' }] }), entry(1), entry(2, { checkpoints: [{ id: 'c', name: 'v1' }] }), entry(3)];
    expect(jumpCheckpoint(es, null, 'older')).toEqual({ commitId: 'vc_2', createdAt: es[2].createdAt });
    expect(jumpCheckpoint(es, 'vc_2', 'older')).toBeNull();
    expect(jumpCheckpoint(es, 'vc_3', 'newer')).toEqual({ commitId: 'vc_2', createdAt: es[2].createdAt });
    expect(jumpCheckpoint(es, 'vc_2', 'newer')).toBe('now');
  });

  test('slot width and snapping', () => {
    expect(slotWidth(1000, 10)).toBe(28);
    expect(slotWidth(1000, 500)).toBe(12);
    expect(slotWidth(1000, 80)).toBe(12.5);
    const xs = [10, 30, 50];
    expect(nearestTick(xs, 33, 8)).toBe(1);
    expect(nearestTick(xs, 40, 8)).toBe(-1);
    expect(releaseTick(xs, 40)).toBe(1); // nearest earlier
    expect(releaseTick(xs, 5)).toBe(0);
    expect(releaseTick(xs, 49)).toBe(2);
    expect(releaseTick([], 5)).toBe(-1);
  });

  test('retention boundary and ordering', () => {
    const now = Date.UTC(2026, 8, 28);
    const day = 86_400_000;
    const es = [{ createdAt: new Date(now - 9 * day).toISOString() }, { createdAt: new Date(now - 8 * day).toISOString() }, { createdAt: new Date(now - day).toISOString() }];
    expect(retentionBoundary(es, now)).toBe(2);
    expect(retentionBoundary(es.slice(0, 2), now)).toBe(-1);
    const [a, b] = orderPair(es[2], es[0]);
    expect(a).toBe(es[0]);
    expect(b).toBe(es[2]);
  });

  test('delta and unit formatting', () => {
    expect(formatDelta(0)).toBe('±0 B');
    expect(formatDelta(1536)).toBe('+1.5 KB');
    expect(formatDelta(-1536)).toBe('−1.5 KB');
    expect(splitUnit('4.2 MB')).toEqual({ value: '4.2', unit: 'MB' });
    expect(splitUnit('—')).toEqual({ value: '—', unit: '' });
  });
});
