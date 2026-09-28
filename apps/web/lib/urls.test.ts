import { describe, expect, test } from 'bun:test';
import { qs } from './api/client';
import { compareHref, contentUrl, driveCompareHref, driveHref, publicContentUrl, publicShareHref, zipUrl } from './urls';

describe('urls', () => {
  test('contentUrl / zipUrl', () => {
    expect(contentUrl('ws1', '/a b/c.txt')).toBe('/api/w/ws1/files/content?path=%2Fa+b%2Fc.txt');
    expect(contentUrl('ws1', '/x', { at: 'vc_1', download: true })).toBe('/api/w/ws1/files/content?path=%2Fx&at=vc_1&download=1');
    expect(zipUrl('ws1', ['/a', '/b'], null)).toBe('/api/w/ws1/files/zip?paths=%2Fa&paths=%2Fb');
  });
  test('drive and compare hrefs', () => {
    expect(driveHref('/')).toBe('/drive');
    expect(driveHref('/My Docs/sub')).toBe('/drive/My%20Docs/sub');
    expect(compareHref('/a.md', 'vc_1', 'vc_2')).toBe('/compare?path=%2Fa.md&a=vc_1&b=vc_2');
    expect(driveCompareHref('vc_1', 'vc_2')).toBe('/compare/drive?a=vc_1&b=vc_2');
  });
  test('public urls', () => {
    expect(publicContentUrl('tok', '/f.txt', { download: true })).toBe('/api/public/s/tok/content?path=%2Ff.txt&download=1');
    expect(publicShareHref('tok')).toBe('/s/tok');
    expect(publicShareHref('tok', '/sub dir')).toBe('/s/tok/sub%20dir');
  });
  test('qs skips empty values', () => {
    expect(qs({ a: undefined, b: null, c: '', d: 0, e: false })).toBe('?d=0&e=false');
    expect(qs({})).toBe('');
  });
});
