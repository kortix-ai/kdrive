import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MiB } from '@volumes/shared';
import { SourceLines } from './code-view';
import { contentErrorCopy } from './content';
import { parseCsv } from './csv-view';
import { FilePreview, rendererFor } from './file-preview';
import { stepZoom } from './image-view';
import { MarkdownBody, safeHref, safeImageSrc } from './markdown-view';
import { compareEntries, middleTruncate, stepSibling, typeLabel } from './names';
import { prettyJson } from './text-view';
import { formatDuration } from './video-view';

describe('rendererFor', () => {
  test('every SPEC preview type gets its renderer', () => {
    expect(rendererFor('cover.png', 10)).toBe('image');
    expect(rendererFor('a.PDF', 10)).toBe('pdf');
    expect(rendererFor('clip.mp4', 10)).toBe('video');
    expect(rendererFor('song.mp3', 10)).toBe('audio');
    expect(rendererFor('notes.md', 10)).toBe('markdown');
    expect(rendererFor('main.ts', 10)).toBe('code');
    expect(rendererFor('log.txt', 10)).toBe('text');
    expect(rendererFor('data.json', 10)).toBe('json');
    expect(rendererFor('rows.csv', 10)).toBe('csv');
    expect(rendererFor('blob.bin', 10)).toBe('none');
  });

  test('active content is only ever shown as source', () => {
    for (const n of ['index.html', 'page.htm', 'logo.svg', 'feed.xml', 'app.js', 'mod.mjs', 'x.xhtml']) {
      expect(rendererFor(n, 100)).toBe('source');
    }
  });

  test('text-like files over 5 MiB are too large; media is not', () => {
    expect(rendererFor('big.md', 5 * MiB + 1)).toBe('too-large');
    expect(rendererFor('big.html', 6 * MiB)).toBe('too-large');
    expect(rendererFor('big.csv', 5 * MiB)).toBe('csv');
    expect(rendererFor('movie.mp4', 900 * MiB)).toBe('video');
  });
});

describe('safe rendering', () => {
  test('Markdown never renders raw HTML or scriptable links', () => {
    const md = [
      '# Title',
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(2)">',
      '[bad](javascript:alert(3)) [ok](https://example.com) [rel](other.md)',
      '![pic](https://example.com/a.png) ![local](./a.png)',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '- [x] done',
    ].join('\n\n');
    const html = renderToStaticMarkup(<MarkdownBody text={md} />);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('href="other.md"');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain('src="./a.png"');
    expect(html).toContain('<table');
    expect(html).toContain('<h1');
  });

  test('source view escapes markup', () => {
    const html = renderToStaticMarkup(<SourceLines text={'<svg onload="alert(1)"><script>x</script></svg>'} />);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;svg onload=');
  });

  test('FilePreview never puts an SVG or HTML file into <img>, <iframe> or <object>', () => {
    for (const name of ['logo.svg', 'index.html']) {
      const html = renderToStaticMarkup(<FilePreview src="/api/x" downloadHref="/api/x?download=1" name={name} size={100} />);
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<object');
      expect(html).toContain('data-renderer="source"');
    }
  });

  test('safeHref / safeImageSrc', () => {
    expect(safeHref('https://a.b/c')).toBe('https://a.b/c');
    expect(safeHref('mailto:x@y.z')).toBe('mailto:x@y.z');
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('/api/w/x/files/delete')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeImageSrc('https://a.b/i.png')).toBe('https://a.b/i.png');
    expect(safeImageSrc('data:image/svg+xml,<svg/>')).toBeNull();
    expect(safeImageSrc('/api/w/x/files/content?path=/a.svg')).toBeNull();
  });
});

describe('helpers', () => {
  test('middleTruncate keeps the extension', () => {
    expect(middleTruncate('short.pdf', 40)).toBe('short.pdf');
    const t = middleTruncate('quarterly-report-2026-final-final-v3.pdf', 24);
    expect(t.endsWith('.pdf')).toBe(true);
    expect(t).toContain('…');
    expect(t.length).toBeLessThanOrEqual(24);
  });

  test('compareEntries: folders first, natural order', () => {
    const names = [
      { name: 'b10.txt', type: 'file' },
      { name: 'B2.txt', type: 'file' },
      { name: 'zeta', type: 'dir' },
      { name: 'alpha', type: 'dir' },
    ].sort(compareEntries);
    expect(names.map((n) => n.name)).toEqual(['alpha', 'zeta', 'B2.txt', 'b10.txt']);
  });

  test('stepSibling', () => {
    const s = ['/a', '/b', '/c'];
    expect(stepSibling(s, '/b', 1)).toBe('/c');
    expect(stepSibling(s, '/b', -1)).toBe('/a');
    expect(stepSibling(s, '/c', 1)).toBeNull();
    expect(stepSibling(s, '/x', 1)).toBeNull();
  });

  test('typeLabel', () => {
    expect(typeLabel('cover.png')).toBe('PNG');
    expect(typeLabel('Makefile')).toBe('FILE');
  });

  test('prettyJson', () => {
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson('{nope')).toBeNull();
  });

  test('parseCsv: header, row cap, ragged rows, TSV', () => {
    const rows = ['id,name', ...Array.from({ length: 1500 }, (_, i) => `${i},n${i}`)].join('\n');
    const t = parseCsv(rows);
    expect(t.header).toEqual(['id', 'name']);
    expect(t.rows.length).toBe(1000);
    expect(t.totalRows).toBe(1500);
    expect(parseCsv('a,b\n1,2,3').columns).toBe(3);
    expect(parseCsv('a\tb\n1\t2').header).toEqual(['a', 'b']);
    expect(parseCsv('').columns).toBe(0);
  });

  test('formatDuration', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  test('stepZoom', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.33, 1)).toBe(0.5);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.1, -1)).toBe(0.1);
  });

  test('contentErrorCopy', () => {
    expect(contentErrorCopy(410, 'version_gone').title).toBe('This version is no longer kept.');
    expect(contentErrorCopy(404, 'path_not_found').retry).toBe(false);
    expect(contentErrorCopy(500, 'internal')).toEqual({ title: "Couldn't load this file", retry: true });
    expect(contentErrorCopy(410, 'link_revoked').title).toBe('This link is no longer active.');
  });
});
