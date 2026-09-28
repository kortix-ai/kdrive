import { describe, expect, test } from 'bun:test';
import { codeLanguage, isActiveContent, isTextLike, mimeFor, previewKind } from './mime';
import { formatBytes, meterLevel, shortId } from './format';

describe('mime', () => {
  test('mimeFor', () => {
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('/x/y/a.PDF')).toBe('application/pdf');
    expect(mimeFor('a.ts')).toBe('text/plain; charset=utf-8');
    expect(mimeFor('README')).toBe('text/plain; charset=utf-8');
    expect(mimeFor('a.bin')).toBe('application/octet-stream');
  });
  test('previewKind', () => {
    expect(previewKind('a.jpg')).toBe('image');
    expect(previewKind('a.svg')).toBe('code');
    expect(previewKind('a.pdf')).toBe('pdf');
    expect(previewKind('a.mp4')).toBe('video');
    expect(previewKind('a.mp3')).toBe('audio');
    expect(previewKind('a.md')).toBe('markdown');
    expect(previewKind('a.csv')).toBe('csv');
    expect(previewKind('a.json')).toBe('json');
    expect(previewKind('a.py')).toBe('code');
    expect(previewKind('a.html')).toBe('code');
    expect(previewKind('a.txt')).toBe('text');
    expect(previewKind('a.zip')).toBe('none');
  });
  test('codeLanguage', () => {
    expect(codeLanguage('a.tsx')).toBe('tsx');
    expect(codeLanguage('Dockerfile')).toBe('docker');
    expect(codeLanguage('a.unknown')).toBe('text');
  });
  test('active content', () => {
    for (const n of ['a.html', 'a.HTM', 'a.xhtml', 'a.svg', 'a.xml', 'a.js', 'a.mjs', 'a.cjs']) expect(isActiveContent(n)).toBe(true);
    for (const n of ['a.png', 'a.ts', 'a.md', 'a.pdf']) expect(isActiveContent(n)).toBe(false);
  });
  test('isTextLike', () => {
    expect(isTextLike('a.md')).toBe(true);
    expect(isTextLike('a.csv')).toBe(true);
    expect(isTextLike('a.png')).toBe(false);
  });
});

describe('format', () => {
  test('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(formatBytes(10 * 1024 ** 3)).toBe('10 GB');
    expect(formatBytes(-1536)).toBe('−1.5 KB');
  });
  test('meterLevel', () => {
    expect(meterLevel(0, 100)).toBe('ok');
    expect(meterLevel(79, 100)).toBe('ok');
    expect(meterLevel(80, 100)).toBe('amber');
    expect(meterLevel(95, 100)).toBe('red');
    expect(meterLevel(120, 100)).toBe('red');
  });
  test('shortId', () => {
    expect(shortId('vc_01J8ZQ3ABCDEFGHJKMNPQRSTVW')).toBe('@pqrstvw');
    // Commits made in the same second differ in the tail, not the timestamp prefix.
    expect(shortId('vc_01M3K9CWJB6Y156PNYW4X90FVF')).not.toBe(shortId('vc_01M3K9CWJ40P2PDAAJPKCDX91Z'));
    expect(shortId(null)).toBe('');
  });
});
