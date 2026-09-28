import { describe, expect, test } from 'bun:test';
import { csvSummary, diffCsv, parseCsv } from './csv-diff';

describe('csv-diff', () => {
  test('parseCsv handles quotes, BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\n"x, y",2\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', '2'],
    ]);
    expect(parseCsv('a\tb\n1\t2', { delimiter: '\t' })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('keyed by the first column: changed cell, added and removed rows', () => {
    const a = 'id,name,qty\n1,apple,3\n2,pear,5\n3,plum,1\n';
    const b = 'id,name,qty\n1,apple,4\n3,plum,1\n4,kiwi,9\n';
    const d = diffCsv(a, b);
    expect(d.keyedBy).toBe('first-column');
    expect(d.columns).toEqual(['id', 'name', 'qty']);
    expect(d.headerChanged).toBe(false);
    expect(d.rows.map((r) => [r.key, r.status])).toEqual([
      ['1', 'mod'],
      ['2', 'del'],
      ['3', 'same'],
      ['4', 'add'],
    ]);
    const mod = d.rows[0];
    expect(mod.cells[2]).toEqual({ a: '3', b: '4', changed: true });
    expect(mod.cells[1].changed).toBe(false);
    expect(d.changedCells).toBe(1);
    expect(d.addedRows).toBe(1);
    expect(d.removedRows).toBe(1);
    expect(csvSummary(d)).toBe('+1 row −1 row · 1 cell changed');
  });

  test('reordered rows are matched by key, not position', () => {
    const d = diffCsv('k,v\na,1\nb,2\n', 'k,v\nb,2\na,1\n');
    expect(d.rows.every((r) => r.status === 'same')).toBe(true);
  });

  test('falls back to index when the first column repeats', () => {
    const d = diffCsv('k,v\nx,1\nx,2\n', 'k,v\nx,1\nx,3\nx,4\n');
    expect(d.keyedBy).toBe('index');
    expect(d.rows.map((r) => r.status)).toEqual(['same', 'mod', 'add']);
    expect(d.rows[1].cells[1]).toEqual({ a: '2', b: '3', changed: true });
  });

  test('columns align by header name when a column is added', () => {
    const d = diffCsv('id,name\n1,a\n', 'id,note,name\n1,hi,a\n');
    expect(d.columns).toEqual(['id', 'note', 'name']);
    expect(d.headerChanged).toBe(true);
    const row = d.rows[0];
    expect(row.cells[1]).toEqual({ a: null, b: 'hi', changed: true });
    expect(row.cells[2]).toEqual({ a: 'a', b: 'a', changed: false });
  });

  test('removed row before any match goes first', () => {
    const d = diffCsv('k\na\nb\n', 'k\nb\n');
    expect(d.rows.map((r) => [r.key, r.status])).toEqual([
      ['a', 'del'],
      ['b', 'same'],
    ]);
  });

  test('empty sides', () => {
    const d = diffCsv('', 'a,b\n1,2\n');
    expect(d.rows.map((r) => r.status)).toEqual(['add']);
    expect(csvSummary(diffCsv('a\n1\n', 'a\n1\n'))).toBe('No row changes');
    expect(csvSummary({ addedRows: 2, removedRows: 1, changedCells: 4 })).toBe('+2 rows −1 row · 4 cells changed');
  });
});
