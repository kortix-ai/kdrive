import { describe, expect, test } from 'bun:test';
import {
  PathError, basename, decodePathFromUrl, dirname, encodePathForUrl, extname, isWithin, joinPath,
  keepBothName, nextFreeName, normalizePath, relativeTo, splitPath, tryNormalizePath,
} from './paths';

describe('normalizePath', () => {
  test('root forms', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('//')).toBe('/');
    expect(normalizePath('.')).toBe('/');
  });
  test('makes absolute, drops trailing slash and empty segments', () => {
    expect(normalizePath('a/b/')).toBe('/a/b');
    expect(normalizePath('/a//b/./c')).toBe('/a/b/c');
  });
  test('collapses .. but never above the root', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
    expect(() => normalizePath('/../x')).toThrow(PathError);
    expect(() => normalizePath('/a/../../x')).toThrow(PathError);
  });
  test('NFC normalisation', () => {
    const decomposed = '/café.txt';
    expect(normalizePath(decomposed)).toBe('/café.txt');
  });
  test('rejects control characters and NUL', () => {
    expect(() => normalizePath('/a\u0000b')).toThrow(PathError);
    expect(() => normalizePath('/a\nb')).toThrow(PathError);
    expect(() => normalizePath('/a\u007fb')).toThrow(PathError);
  });
  test('backslashes are separators', () => {
    // A backslash is never a separator: it is an invalid name character.
    expect(() => normalizePath('a\\b')).toThrow(PathError);
    expect(() => normalizePath('/Q1\\report.txt')).toThrow('Name cannot contain "\\".');
  });
  test('rejects too-long segments and paths', () => {
    expect(() => normalizePath('/' + 'x'.repeat(256))).toThrow(PathError);
    expect(normalizePath('/' + 'x'.repeat(255))).toHaveLength(256);
    expect(() => normalizePath(('/' + 'x'.repeat(200)).repeat(25))).toThrow(PathError);
  });
  test('tryNormalizePath returns null on bad input', () => {
    expect(tryNormalizePath('/../x')).toBeNull();
    expect(tryNormalizePath('a')).toBe('/a');
  });
});

describe('helpers', () => {
  test('joinPath', () => {
    expect(joinPath('/a', 'b', 'c.txt')).toBe('/a/b/c.txt');
    expect(joinPath('/', '/x')).toBe('/x');
    expect(joinPath('/a', '')).toBe('/a');
  });
  test('dirname / basename / splitPath', () => {
    expect(dirname('/a/b/c')).toBe('/a/b');
    expect(dirname('/a')).toBe('/');
    expect(dirname('/')).toBe('/');
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(basename('/')).toBe('');
    expect(splitPath('/a/b')).toEqual(['a', 'b']);
  });
  test('extname', () => {
    expect(extname('a.TXT')).toBe('.txt');
    expect(extname('a.tar.gz')).toBe('.gz');
    expect(extname('.bashrc')).toBe('');
    expect(extname('noext')).toBe('');
    expect(extname('/dir.d/file')).toBe('');
  });
  test('isWithin / relativeTo', () => {
    expect(isWithin('/', '/a')).toBe(true);
    expect(isWithin('/a', '/a')).toBe(true);
    expect(isWithin('/a', '/a/b')).toBe(true);
    expect(isWithin('/a', '/ab')).toBe(false);
    expect(relativeTo('/a', '/a/b/c')).toBe('/b/c');
    expect(relativeTo('/a', '/a')).toBe('/');
    expect(relativeTo('/', '/x')).toBe('/x');
    expect(() => relativeTo('/a', '/b')).toThrow(PathError);
  });
  test('url encoding round trip', () => {
    const p = '/My Docs/100% real #1?.txt';
    const enc = encodePathForUrl(p);
    expect(enc).toBe('My%20Docs/100%25%20real%20%231%3F.txt');
    expect(decodePathFromUrl(enc.split('/'))).toBe(p);
    expect(decodePathFromUrl(undefined)).toBe('/');
    expect(decodePathFromUrl([])).toBe('/');
    expect(() => decodePathFromUrl(['..', 'x'])).toThrow(PathError);
  });
  test('keepBothName', () => {
    expect(keepBothName('a.txt', 1)).toBe('a (1).txt');
    expect(keepBothName('a', 1)).toBe('a (1)');
    expect(keepBothName('a.tar.gz', 1)).toBe('a (1).tar.gz');
    expect(keepBothName('photo.final.jpg', 2)).toBe('photo.final (2).jpg');
    expect(keepBothName('.env', 1)).toBe('.env (1)');
  });
  test('nextFreeName', () => {
    expect(nextFreeName('a.txt', new Set())).toBe('a.txt');
    expect(nextFreeName('a.txt', new Set(['a.txt', 'a (1).txt']))).toBe('a (2).txt');
  });
});
