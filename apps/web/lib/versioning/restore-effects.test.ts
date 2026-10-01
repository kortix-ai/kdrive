import { describe, expect, test } from 'bun:test';
import type { DriveChange } from '@volumes/shared';
import { changesUnder, restoreEffects } from './restore-effects';

const changes: DriveChange[] = [
  { op: 'changed', path: '/Reports/q3.pdf', type: 'file', sizeA: 1, sizeB: 2 },
  { op: 'changed', path: '/Reports/q4.pdf', type: 'file', sizeA: 1, sizeB: 2 },
  { op: 'removed', path: '/Reports/old.xlsx', type: 'file', sizeA: 10 },
  { op: 'added', path: '/Reports/new.txt', type: 'file', sizeB: 3 },
  { op: 'added', path: '/Reports/Drafts', type: 'dir' },
  { op: 'moved', path: '/Archive/a.txt', fromPath: '/Reports/a.txt', type: 'file' },
  { op: 'added', path: '/Photos/x.png', type: 'file', sizeB: 3 },
];

describe('restore effects', () => {
  test('whole drive', () => {
    expect(restoreEffects(changes)).toEqual([
      { mark: '~', count: 2, text: '2 files go back to that version' },
      { mark: '+', count: 1, text: '1 file comes back' },
      { mark: '−', count: 3, text: '2 files and 1 folder added since then are removed' },
      { mark: '→', count: 1, text: '1 file moves back to where it was' },
    ]);
  });

  test('scoped to a folder, including moves out of it', () => {
    const scoped = changesUnder(changes, '/Reports');
    expect(scoped.map((c) => c.path)).not.toContain('/Photos/x.png');
    expect(scoped.map((c) => c.path)).toContain('/Archive/a.txt');
    const lines = restoreEffects(changes, '/Reports');
    expect(lines.find((l) => l.mark === '−')?.text).toBe('1 file and 1 folder added since then are removed');
  });

  test('no changes', () => {
    expect(restoreEffects([], '/')).toEqual([]);
    expect(restoreEffects(changes, '/Nothing')).toEqual([]);
  });
});
