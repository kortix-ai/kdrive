import { describe, expect, test } from 'bun:test';
import type { CategoryUsage } from '@volumes/shared';
import { fileHref, roleLabel, segments } from './storage-insights';

const cat = (category: CategoryUsage['category'], bytes: number): CategoryUsage => ({ category, bytes, files: bytes > 0 ? 1 : 0 });

describe('storage insights', () => {
  test('segments: categories with bytes, in order, as a share of the total', () => {
    const s = segments([cat('other', 10), cat('images', 30), cat('videos', 0), cat('documents', 20)], 100, 5);
    expect(s.map((x) => [x.key, x.pct])).toEqual([
      ['images', 30],
      ['documents', 20],
      ['other', 10],
      ['overhead', 5],
    ]);
    expect(segments([cat('images', 0)], 100)).toEqual([]);
  });

  test('segments: a sliver stays visible and a full bar never overflows', () => {
    const tiny = segments([cat('images', 1), cat('code', 999_999)], 1_000_000);
    expect(tiny[0].pct).toBe(0.6);
    const full = segments([cat('images', 1), cat('audio', 1), cat('code', 10_000)], 10_002);
    expect(full.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 5);
    expect(full.every((x) => x.pct >= 0.6)).toBe(true);
    // Over quota: the files fill the bar.
    const over = segments([cat('videos', 300)], 100);
    expect(over[0].pct).toBe(100);
  });

  test('fileHref opens the preview in its drive', () => {
    expect(fileHref('ws1', '/Photos/My trip/beach 1.png')).toBe('/drive/Photos/My%20trip?ws=ws1&file=beach+1.png');
    expect(fileHref('ws1', '/clip.mp4')).toBe('/drive?ws=ws1&file=clip.mp4');
  });

  test('roleLabel', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('editor')).toBe('Editor');
    expect(roleLabel('former')).toBe('Former member');
  });
});
