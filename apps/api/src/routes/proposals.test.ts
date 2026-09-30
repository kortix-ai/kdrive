import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createAgentToken, makeApp, mcpCall, type Json } from '../../test/helpers';
import { endWorld, freshWorld, upload, user, type User } from '../../test/e2e/kit';

let u: User;
let key: string;

async function propose(changes: Json[], message = ''): Promise<string> {
  const open = await mcpCall(makeApp(), key, 'tools/call', { name: 'open_workspace', arguments: {} });
  const head = open.body!.result.structuredContent.head_commit_id;
  const r = await mcpCall(makeApp(), key, 'tools/call', {
    name: 'write_changes',
    arguments: { last_seen_commit_id: head, message, changes },
  });
  const res = r.body!.result;
  if (res.isError) throw new Error(res.content[0].text);
  return res.structuredContent.proposal_id as string;
}

beforeEach(async () => {
  await freshWorld();
  u = await user('routes-prop@test.local');
  key = await createAgentToken(u.userId, { scope: 'drive:write', mode: 'review', name: 'Route agent' });
});
afterAll(() => endWorld());

describe('proposals routes', () => {
  test('list, count and detail with conflict and compare sides', async () => {
    await upload(u, { '/notes.txt': 'before' });
    const id = await propose([{ op: 'write', path: '/notes.txt', content: 'after' }], 'Edit notes');
    const count = await u.client.get(`/api/w/${u.ws}/proposals/count`);
    expect(count.body).toEqual({ open: 1 });
    const list = await u.client.get(`/api/w/${u.ws}/proposals`);
    expect(list.status).toBe(200);
    expect(list.body.proposals[0]).toMatchObject({ id, message: 'Edit notes', status: 'open', pending: 1 });
    expect(list.body.proposals[0].agent).toMatchObject({ kind: 'token', name: 'Route agent' });
    expect(list.body.openCount).toBe(1);
    await upload(u, { '/notes.txt': 'user changed it' });
    const d = await u.client.get(`/api/w/${u.ws}/proposals/${id}`);
    expect(d.status).toBe(200);
    expect(d.body.conflicts).toBe(1);
    const f = d.body.files[0];
    expect(f.change).toBe('modified');
    expect(f.conflict.reason).toBe('changed');
    expect(f.compare.kind).toBe('text');
    expect(f.compare.a.size).toBe('user changed it'.length);
    expect(f.compare.b.contentUrl).toBe(`/api/w/${u.ws}/proposals/${id}/files/0/content`);
    const closed = await u.client.get(`/api/w/${u.ws}/proposals?status=closed`);
    expect(closed.body.proposals).toHaveLength(0);
  });

  test('staged content follows the file content rules', async () => {
    const id = await propose([
      { op: 'write', path: '/page.html', content: '<script>alert(1)</script>' },
      { op: 'write', path: '/plain.txt', content: 'hi' },
      { op: 'mkdir', path: '/dir' },
    ]);
    const html = await u.client.raw('GET', `/api/w/${u.ws}/proposals/${id}/files/0/content`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(html.headers.get('content-disposition')).toStartWith('attachment;');
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('cache-control')).toBe('private, no-store');
    expect(await html.text()).toBe('<script>alert(1)</script>');
    const txt = await u.client.raw('GET', `/api/w/${u.ws}/proposals/${id}/files/1/content?download=1`);
    expect(txt.headers.get('content-disposition')).toStartWith('attachment;');
    expect(txt.headers.get('content-length')).toBe('2');
    const dir = await u.client.raw('GET', `/api/w/${u.ws}/proposals/${id}/files/2/content`);
    expect(dir.status).toBe(404);
  });

  test('accept and discard over REST, and 404 across users and workspaces', async () => {
    const id = await propose([{ op: 'write', path: '/a.txt', content: 'a' }, { op: 'write', path: '/b.txt', content: 'b' }]);
    const acc = await u.client.post(`/api/w/${u.ws}/proposals/${id}/accept`, { seqs: [0] });
    expect(acc.status).toBe(200);
    expect(acc.body.action.kind).toBe('proposal.accept');
    expect(acc.body.proposal.status).toBe('open');
    const dis = await u.client.post(`/api/w/${u.ws}/proposals/${id}/discard`, {});
    expect(dis.status).toBe(200);
    expect(dis.body.proposal.status).toBe('partial');
    const again = await u.client.post(`/api/w/${u.ws}/proposals/${id}/accept`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('proposal_closed');

    const id2 = await propose([{ op: 'mkdir', path: '/c' }]);
    const other = await user('someone-else@test.local');
    expect((await other.client.get(`/api/w/${other.ws}/proposals/${id2}`)).status).toBe(404);
    expect((await other.client.post(`/api/w/${other.ws}/proposals/${id2}/accept`, {})).status).toBe(404);
    expect((await other.client.get(`/api/w/${u.ws}/proposals/${id2}`)).status).toBe(404);
    const ws2 = await u.client.post('/api/workspaces', { name: 'Second' });
    expect(ws2.status).toBe(201);
    const wid = ws2.body.workspace?.id ?? ws2.body.id;
    expect((await u.client.get(`/api/w/${wid}/proposals/${id2}`)).status).toBe(404);
  });

  test('a stale accept answers 409 stale_base with the conflicts', async () => {
    await upload(u, { '/s.txt': 's' });
    const id = await propose([{ op: 'write', path: '/s.txt', content: 'agent' }]);
    await upload(u, { '/s.txt': 'user' });
    const r = await u.client.post(`/api/w/${u.ws}/proposals/${id}/accept`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('stale_base');
    expect(r.body.error.details.conflicts[0].path).toBe('/s.txt');
    const forced = await u.client.post(`/api/w/${u.ws}/proposals/${id}/accept`, { force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.proposal.status).toBe('accepted');
  });
});
