import { describe, expect, test } from 'bun:test';
import { CSV_COMPARE_MAX_CELLS, CSV_COMPARE_MAX_COLUMNS, CSV_COMPARE_MAX_ROWS, csvRowBudget, diffCsv, diffCsvRows } from './csv-diff';

describe('csv-diff stays bounded for small, hostile files', () => {
  test('two wide, clean headers with no names in common align in linear time', () => {
    // 60,000 columns a side (~0.8 MB for the pair): quadratic alignment takes tens of seconds
    const W = 60_000;
    const ha = Array.from({ length: W }, (_, i) => `a${i}`).join(',');
    const hb = Array.from({ length: W }, (_, i) => `b${i}`).join(',');
    const t0 = performance.now();
    const d = diffCsv(ha + '\n1', hb + '\n1');
    const ms = performance.now() - t0;
    expect(d.totalColumns).toBe(2 * W);
    expect(d.columns.length).toBeLessThanOrEqual(CSV_COMPARE_MAX_COLUMNS);
    expect(d.headerChanged).toBe(true);
    expect(ms).toBeLessThan(2000);
    // shared names still align by name: b's order first, then a's own columns
    const m = diffCsv('id,x,y\n1,2,3', 'id,y,z\n1,3,4');
    expect(m.columns).toEqual(['id', 'y', 'z', 'x']);
  }, 60_000);

  test('a wide header with short rows does not build a cell per header column per row', () => {
    const header = Array.from({ length: 20_000 }, (_, i) => `h${i}`).join(',');
    const rows = Array.from({ length: 200 }, (_, i) => `k${i}`);
    const a = [header, ...rows].join('\n');
    const bRows = [...rows];
    bRows[5] = 'k5,' + Array(14_999).fill('').join(',') + ',changed';
    const d = diffCsv(a, [header, ...bRows].join('\n'));
    expect(d.totalColumns).toBe(20_000);
    expect(d.columns.length).toBeLessThanOrEqual(CSV_COMPARE_MAX_COLUMNS);
    for (const r of d.rows) expect(r.cells.length).toBeLessThanOrEqual(CSV_COMPARE_MAX_COLUMNS);
    // a change past the shown columns still counts
    expect(d.changedCells).toBe(1);
    expect(d.rows.find((r) => r.key === 'k5')?.status).toBe('mod');
  });

  test('positional compare of a very long file does not overflow the stack', () => {
    const row = ['1'];
    const many = [['k', 'k'], ...Array<string[]>(2_100_000).fill(row)];
    const d = diffCsvRows([['k', 'k'], row], many);
    expect(d.keyedBy).toBe('index');
    expect(d.addedRows).toBe(2_100_000 - 1);
  });

  test('rows shown are bounded by the cell budget', () => {
    expect(csvRowBudget(3)).toBe(CSV_COMPARE_MAX_ROWS);
    expect(csvRowBudget(CSV_COMPARE_MAX_COLUMNS) * CSV_COMPARE_MAX_COLUMNS).toBeLessThanOrEqual(CSV_COMPARE_MAX_CELLS);
    expect(csvRowBudget(0)).toBe(CSV_COMPARE_MAX_ROWS);
  });
});
