import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CSV_PREVIEW_MAX_CELLS, CSV_PREVIEW_MAX_COLUMNS, CsvTableView, parseCsv } from './csv-view';
import { MarkdownBody, MARKDOWN_TABLE_MAX_CELLS, MARKDOWN_URL_BUDGET_MIN } from './markdown-view';
import { PRETTY_JSON_MAX_CHARS, prettyJson, prettyJsonResult, prettyJsonSizeBound } from './text-view';

const count = (html: string, needle: string) => html.split(needle).length - 1;

// A shared file can be small and still describe a huge table: a wide header with short
// rows expands every row to the header's width.
describe('previews stay bounded for small, hostile files', () => {
  test('CSV: a 200 KB file with a 100,000-column header renders a bounded number of cells', () => {
    const text = Array(100_000).fill('h').join(',') + '\n' + Array(1000).fill('x').join('\n');
    const t = parseCsv(text);
    expect(t.columns).toBe(100_000);
    expect(t.totalRows).toBe(1000);
    expect(t.shownColumns).toBeLessThanOrEqual(CSV_PREVIEW_MAX_COLUMNS);
    expect(t.header.length).toBeLessThanOrEqual(t.shownColumns);
    expect(t.rows.length * t.shownColumns).toBeLessThanOrEqual(CSV_PREVIEW_MAX_CELLS);
    for (const r of t.rows) expect(r.length).toBeLessThanOrEqual(t.shownColumns);
  });

  test('CSV: the rendered table has at most the cell budget and says what is left out', () => {
    const text = Array(300).fill('h').join(',') + '\n' + Array(1500).fill('x').join('\n');
    const html = renderToStaticMarkup(<CsvTableView table={parseCsv(text)} />);
    const cells = count(html, '<td');
    const rows = count(html, '<tr') - 1;
    expect(cells - rows).toBeLessThanOrEqual(CSV_PREVIEW_MAX_CELLS); // minus the # column
    expect(count(html, '<th ')).toBeLessThanOrEqual(CSV_PREVIEW_MAX_COLUMNS + 1); // + the # column
    expect(html).toContain('showing 1,000 of 1,500 rows and 100 of 300 columns');
    const narrowRows = renderToStaticMarkup(<CsvTableView table={parseCsv(Array(300).fill('h').join(',') + '\nx')} />);
    expect(narrowRows).toContain('showing 100 of 300 columns');
  });

  test('CSV: ordinary files are shown in full, as before', () => {
    const text = ['id,name', ...Array.from({ length: 1500 }, (_, i) => `${i},n${i}`)].join('\n');
    const t = parseCsv(text);
    expect(t.rows.length).toBe(1000);
    expect(t.shownColumns).toBe(2);
    const html = renderToStaticMarkup(<CsvTableView table={t} />);
    expect(html).toContain('showing the first 1,000');
    const wide = parseCsv(Array(40).fill('h').join(',') + '\n' + Array(1000).fill(Array(40).fill('1').join(',')).join('\n'));
    expect(wide.shownColumns).toBe(40);
    expect(wide.rows.length).toBe(1000);
  });

  test('JSON: deep nesting is not pretty-printed into a huge string', () => {
    const deep = '['.repeat(3000) + ']'.repeat(3000);
    expect(prettyJson(deep)).toBeNull(); // would print as ~18 MB from 6 KB
    expect(PRETTY_JSON_MAX_CHARS).toBeGreaterThan(5 * 1024 * 1024 * 3); // large ordinary files still format
    const r = prettyJsonResult(deep);
    expect(r.status).toBe('too-large');
    expect(r.text).toBe(deep);
    // ordinary JSON is unchanged
    expect(prettyJsonResult('{"a":[1,2],"b":{}}')).toEqual({ status: 'pretty', text: JSON.stringify({ a: [1, 2], b: {} }, null, 2) });
    expect(prettyJsonResult('{nope').status).toBe('invalid');
  });

  test('JSON: numbers in exponent form (1e20 prints as 21 digits) count at their printed length', () => {
    // 20 levels deep, 300,000 × "1e20": ~1.5 MB that would print as ~19 MB (over 10× the file)
    const depth = 20;
    const text = '['.repeat(depth) + Array(300_000).fill('1e20').join(',') + ']'.repeat(depth);
    const budget = Math.min(PRETTY_JSON_MAX_CHARS, Math.max(1024 * 1024, text.length * 10));
    expect(JSON.stringify(JSON.parse(text), null, 2).length).toBeGreaterThan(budget);
    const r = prettyJsonResult(text);
    expect(r.status).toBe('too-large');
    expect(r.text.length).toBeLessThanOrEqual(budget);
    // the estimate is exact for numbers: it never under-counts what JSON.stringify prints
    for (const src of ['[1e20,-1.5E+20,1e-7,0.1e1,1e400,-0,12345678901234567890123]', '{"a":[1e21,2e-6],"b":1E2}']) {
      expect(prettyJsonSizeBound(src)).toBeGreaterThanOrEqual(JSON.stringify(JSON.parse(src), null, 2).length);
    }
    // small files with exponents still format
    expect(prettyJsonResult('[1e20]')).toEqual({ status: 'pretty', text: '[\n  100000000000000000000\n]' });
  });

  test('Markdown: one long reference definition used thousands of times does not multiply the URL', () => {
    const url = 'https://example.com/' + 'a'.repeat(20_000);
    const md = `[a]: <${url}>\n\n` + '[a] '.repeat(5000); // ~40 KB
    const html = renderToStaticMarkup(<MarkdownBody text={md} />);
    expect(html.length).toBeLessThan(Math.max(MARKDOWN_URL_BUDGET_MIN, md.length * 2) + 5000 * 300);
    // images and links whose target is not followed (shown with a title) are bounded the same way
    const img = renderToStaticMarkup(<MarkdownBody text={`[a]: <${url}>\n\n` + '![x][a] '.repeat(5000)} />);
    expect(img.length).toBeLessThan(MARKDOWN_URL_BUDGET_MIN + 5000 * 300);
    const unsafe = renderToStaticMarkup(<MarkdownBody text={`[a]: <ftp://${'b'.repeat(20_000)}>\n\n` + '[a] '.repeat(5000)} />);
    expect(unsafe.length).toBeLessThan(MARKDOWN_URL_BUDGET_MIN + 5000 * 300);
    // ordinary reference links still work
    const ok = renderToStaticMarkup(<MarkdownBody text={'[docs]: https://example.com/docs\n\nSee [docs] and [docs].'} />);
    expect(count(ok, 'href="https://example.com/docs"')).toBe(2);
    // Three renders of 5,000 references: seconds of work on a busy machine.
  }, 60_000);

  test('Markdown: a wide table with short rows renders a bounded number of cells', () => {
    const md = ['|' + Array(1000).fill('h').join('|') + '|', '|' + Array(1000).fill('-').join('|') + '|', ...Array(100).fill('|x|')].join('\n');
    const html = renderToStaticMarkup(<MarkdownBody text={md} />);
    expect(count(html, '<td') + count(html, '<th ') + count(html, '<th>')).toBeLessThanOrEqual(MARKDOWN_TABLE_MAX_CELLS);
    expect(html).toContain('of 1,000 columns');
    // many rows: cut to the document's cell budget
    const tall = ['|' + Array(20).fill('h').join('|') + '|', '|' + Array(20).fill('-').join('|') + '|', ...Array(2000).fill('|' + Array(20).fill('1').join('|') + '|')].join('\n');
    const tallHtml = renderToStaticMarkup(<MarkdownBody text={tall} />);
    expect(count(tallHtml, '<td') + count(tallHtml, '<th ') + count(tallHtml, '<th>')).toBeLessThanOrEqual(MARKDOWN_TABLE_MAX_CELLS);
    expect(tallHtml).toContain('of 2,000 rows');
    // ordinary tables are untouched
    const small = renderToStaticMarkup(<MarkdownBody text={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(count(small, '<td')).toBe(2);
    expect(small).not.toContain('Table shortened');
  });
});
