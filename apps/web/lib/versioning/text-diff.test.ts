import { describe, expect, test } from 'bun:test';
import { computeTextDiff, diffSummary, foldRows, normalizeText, splitLines, wordSegments } from './text-diff';

describe('text-diff', () => {
  test('splitLines handles trailing newlines and empty input', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('\n')).toEqual(['']);
  });

  test('normalizeText converts CRLF, strips BOM and pretty-prints JSON', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(normalizeText('﻿x')).toBe('x');
    expect(normalizeText('{"a":1,"b":[1,2]}', { json: true })).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
    expect(normalizeText('{not json', { json: true })).toBe('{not json');
  });

  test('identical texts', () => {
    const d = computeTextDiff('one\ntwo\n', 'one\ntwo')!;
    expect(d.identical).toBe(true);
    expect(d.blocks).toBe(0);
    expect(d.split.every((r) => r.type === 'same')).toBe(true);
    expect(d.split.length).toBe(2);
  });

  test('a changed line pairs with word-level segments', () => {
    const d = computeTextDiff('# Title\nThe quick brown fox\nend\n', '# Title\nThe quick red fox\nend\n')!;
    expect(d.identical).toBe(false);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.blocks).toBe(1);
    const change = d.split.find((r) => r.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('no change row');
    expect(change.a?.num).toBe(2);
    expect(change.b?.num).toBe(2);
    expect(change.a?.segs?.filter((s) => s.kind === 'del').map((s) => s.text.trim())).toEqual(['brown']);
    expect(change.b?.segs?.filter((s) => s.kind === 'add').map((s) => s.text.trim())).toEqual(['red']);
    // segments rebuild the original lines
    expect(change.a?.segs?.map((s) => s.text).join('')).toBe('The quick brown fox');
    expect(change.b?.segs?.map((s) => s.text).join('')).toBe('The quick red fox');
    // unified: del then add inside the block, line numbers kept
    const u = d.unified.filter((r) => r.type !== 'same');
    expect(u.map((r) => [r.type, r.aNum, r.bNum])).toEqual([
      ['del', 2, null],
      ['add', null, 2],
    ]);
  });

  test('pure additions and removals', () => {
    const d = computeTextDiff('a\nb\n', 'a\nx\ny\nb\n')!;
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
    const rows = d.split.filter((r) => r.type === 'change');
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.type === 'change' && r.a === null && r.b !== null)).toBe(true);
    const r = computeTextDiff('a\nb\nc\n', 'a\n')!;
    expect(r.removed).toBe(2);
    expect(r.added).toBe(0);
    expect(r.split.filter((x) => x.type === 'change').every((x) => x.type === 'change' && x.b === null)).toBe(true);
  });

  test('uneven changed block: pairs then leftovers', () => {
    const d = computeTextDiff('keep\nold1\nold2\nold3\n', 'keep\nnew1\n')!;
    expect(d.blocks).toBe(1);
    const change = d.split.filter((r) => r.type === 'change');
    expect(change.length).toBe(3);
    expect(change[0].type === 'change' && change[0].a && change[0].b).toBeTruthy();
    expect(change[1].type === 'change' && change[1].b).toBeNull();
    expect(diffSummary(d)).toBe('+1 −3 lines · 1 change');
  });

  test('two separate change blocks', () => {
    const a = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
    const b = ['1', 'two', '3', '4', '5', '6', '7', '8', 'nine', '10'].join('\n');
    const d = computeTextDiff(a, b)!;
    expect(d.blocks).toBe(2);
    expect(diffSummary(d)).toBe('+2 −2 lines · 2 changes');
  });

  test('empty to text', () => {
    const d = computeTextDiff('', 'hello\n')!;
    expect(d.added).toBe(1);
    expect(d.split).toEqual([{ type: 'change', a: null, b: { num: 1, text: 'hello' }, block: 0 }]);
  });

  test('wordSegments marks nothing for equal lines', () => {
    const w = wordSegments('same line', 'same line');
    expect(w.a).toEqual([{ text: 'same line', kind: 'same' }]);
    expect(w.b).toEqual([{ text: 'same line', kind: 'same' }]);
  });

  test('foldRows folds long unchanged runs and keeps context', () => {
    const rows = [...Array(20).fill('s'), 'c', ...Array(20).fill('s')];
    const out = foldRows(rows, (r) => r === 's');
    const folds = out.filter((x) => typeof x !== 'number');
    expect(folds).toEqual([
      { type: 'fold', start: 0, end: 17, count: 17 },
      { type: 'fold', start: 24, end: 41, count: 17 },
    ]);
    // context: 3 lines before and after the change stay visible
    expect(out.filter((x) => typeof x === 'number')).toEqual([17, 18, 19, 20, 21, 22, 23]);
  });

  test('foldRows keeps short runs and honours expanded folds', () => {
    const short = ['c', 's', 's', 's', 's', 's', 's', 'c'];
    expect(foldRows(short, (r) => r === 's').every((x) => typeof x === 'number')).toBe(true);
    const rows = [...Array(12).fill('s'), 'c'];
    const folded = foldRows(rows, (r) => r === 's');
    expect(folded[0]).toEqual({ type: 'fold', start: 0, end: 9, count: 9 });
    const open = foldRows(rows, (r) => r === 's', { expanded: new Set([0]) });
    expect(open.length).toBe(13);
  });

  test('diffSummary for identical', () => {
    expect(diffSummary({ added: 0, removed: 0, blocks: 0 })).toBe('No line changes');
  });
});
