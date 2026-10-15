import { describe, expect, test } from 'bun:test';
import type { FileComment } from '@volumes/shared';
import { nextLabelColor } from '@/components/labels/label-chip';
import { labelIndex } from '@/lib/annotations';
import { linkify } from './comment-text';
import { threadsOf } from './comments-section';

describe('comment text', () => {
  test('links http(s) addresses and leaves sentence punctuation outside', () => {
    expect(linkify('See https://example.com/a?b=1. Then (http://x.io/p).')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', href: 'https://example.com/a?b=1', text: 'https://example.com/a?b=1' },
      { kind: 'text', text: '. Then (' },
      { kind: 'link', href: 'http://x.io/p', text: 'http://x.io/p' },
      { kind: 'text', text: ').' },
    ]);
    expect(linkify('https://en.wikipedia.org/wiki/Foo_(bar)')[0]).toMatchObject({ href: 'https://en.wikipedia.org/wiki/Foo_(bar)' });
    expect(linkify('javascript:alert(1) ftp://x')).toEqual([{ kind: 'text', text: 'javascript:alert(1) ftp://x' }]);
  });

  test('threads group replies under their first comment', () => {
    const c = (id: string, parentId: string | null) => ({ id, parentId }) as FileComment;
    const t = threadsOf([c('a', null), c('b', 'a'), c('c', null), c('d', 'a')]);
    expect(t.map((x) => [x.root.id, x.replies.map((r) => r.id)])).toEqual([
      ['a', ['b', 'd']],
      ['c', []],
    ]);
  });
});

describe('tags', () => {
  test('a new tag takes the least used colour', () => {
    expect(nextLabelColor([])).toBe('slate');
    expect(nextLabelColor([{ color: 'slate' }, { color: 'sage' }])).toBe('moss');
  });

  test('items index their tags by name', () => {
    const data = {
      labels: [
        { id: '1', name: 'Zeta', color: 'sky' as const, count: 1, createdAt: '' },
        { id: '2', name: 'Alpha', color: 'rose' as const, count: 1, createdAt: '' },
      ],
      assignments: [{ path: '/a', labelIds: ['1', '2', 'gone'] }],
    };
    expect(labelIndex(data)!.byPath.get('/a')!.map((l) => l.name)).toEqual(['Alpha', 'Zeta']);
    expect(labelIndex(data)).toBe(labelIndex(data));
  });
});
