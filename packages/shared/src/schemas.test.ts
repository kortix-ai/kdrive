import { describe, expect, test } from 'bun:test';
import { CreateLinkRequest, ListQuery, RestoreRequest, SetQuotaRequest, UploadPlanRequest, ZipQuery } from './index';
import { GiB } from './constants';

describe('schemas', () => {
  test('ListQuery normalises paths and defaults to root', () => {
    expect(ListQuery.parse({}).path).toBe('/');
    expect(ListQuery.parse({ path: 'a//b/' }).path).toBe('/a/b');
    expect(ListQuery.safeParse({ path: '/../x' }).success).toBe(false);
  });
  test('ZipQuery accepts one or many paths', () => {
    expect(ZipQuery.parse({ paths: '/a' }).paths).toEqual(['/a']);
    expect(ZipQuery.parse({ paths: ['/a', 'b'] }).paths).toEqual(['/a', '/b']);
    expect(ZipQuery.safeParse({}).success).toBe(false);
  });
  test('UploadPlanRequest', () => {
    const sha = 'a'.repeat(64);
    const ok = UploadPlanRequest.parse({ files: [{ path: 'x.txt', size: 3, blocks: [sha] }] });
    expect(ok.conflict).toBe('ask');
    expect(ok.dirs).toEqual([]);
    expect(ok.files[0].path).toBe('/x.txt');
    expect(UploadPlanRequest.safeParse({ files: [], dirs: [] }).success).toBe(false);
    expect(UploadPlanRequest.safeParse({ files: [{ path: '/x', size: 1, blocks: ['XYZ'] }] }).success).toBe(false);
  });
  test('RestoreRequest requires a path except for drive', () => {
    expect(RestoreRequest.safeParse({ scope: 'drive', at: 'vc_x' }).success).toBe(true);
    expect(RestoreRequest.safeParse({ scope: 'file', at: 'vc_x' }).success).toBe(false);
    expect(RestoreRequest.safeParse({ scope: 'file', at: 'bad ref' , path: '/a'}).success).toBe(false);
  });
  test('SetQuotaRequest caps at 1 TiB (the Pro plan)', () => {
    expect(SetQuotaRequest.safeParse({ quotaBytes: 1024 * GiB }).success).toBe(true);
    expect(SetQuotaRequest.safeParse({ quotaBytes: 1024 * GiB + 1 }).success).toBe(false);
    expect(SetQuotaRequest.safeParse({ quotaBytes: 0 }).success).toBe(false);
  });
  test('CreateLinkRequest expiry', () => {
    expect(CreateLinkRequest.safeParse({ path: '/a', mode: 'live', expiresAt: '2030-01-01T00:00:00.000Z' }).success).toBe(true);
    expect(CreateLinkRequest.safeParse({ path: '/a', mode: 'live', expiresAt: 'tomorrow' }).success).toBe(false);
  });
});
