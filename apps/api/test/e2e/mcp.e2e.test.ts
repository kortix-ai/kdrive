// End to end over the network: the real API server in a child process, an
// agent token, and the MCP SDK client over Streamable HTTP.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { agentTokens } from '../../src/db/schema';
import { createAgentToken, resetDb, type Json } from '../helpers';
import { startServer, type RunningServer } from './spawn-server';

let server: RunningServer;
let base: string;
let cookie = '';
let userId = '';
let wsId = '';

/** fetch as the signed-in owner (cookie jar + same-origin Origin). */
async function owner(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(base + path, {
    method,
    headers: { origin: base, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A token through the tokens route (falls back to a direct insert while that route is not there). */
async function token(scope: 'drive:read' | 'drive:propose' | 'drive:write', mode: 'review' | 'direct', name: string): Promise<{ secret: string; id: string | null }> {
  const r = await owner('POST', '/api/agents/tokens', { name, scope, mode, workspaceId: null, expiresInDays: 30 });
  if (r.status === 201) return { secret: r.body.secret, id: r.body.token.id };
  return { secret: await createAgentToken(userId, { scope, mode, name }), id: null };
}

async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: 'e2e-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport);
  return client;
}

type Result = { content: Json[]; structuredContent?: Json; isError?: boolean };
async function call(c: Client, name: string, args: Json = {}): Promise<Result> {
  return (await c.callTool({ name, arguments: args })) as Result;
}

beforeAll(async () => {
  await resetDb();
  // The child gets a minimal env; Postgres needs to know which local role to use.
  const role = process.env.PGUSER ?? process.env.USER ?? '';
  server = await startServer({ env: role ? { USER: role, PGUSER: role } : {} });
  base = server.base;
  const r = await owner('POST', '/api/auth/dev/sign-in', { email: 'mcp-e2e@test.local' });
  expect(r.status).toBe(200);
  const me = await owner('GET', '/api/me');
  userId = me.body.user.id;
  wsId = me.body.defaultWorkspaceId;
}, 60_000);

afterAll(async () => {
  await server?.stop();
});

describe('MCP over Streamable HTTP with an agent token', () => {
  test('the full direct-mode tool flow', async () => {
    const { secret } = await token('drive:write', 'direct', 'E2E writer');
    const c = await connect(secret);
    expect((await c.listTools()).tools).toHaveLength(13);

    const opened = await call(c, 'open_workspace');
    const head0 = opened.structuredContent!.head_commit_id as string;
    const text = 'ü'.repeat(40) + '\nend\n';
    const w = await call(c, 'write_changes', {
      last_seen_commit_id: head0,
      message: 'Set up the project',
      changes: [
        { op: 'mkdir', path: '/project' },
        { op: 'write', path: '/project/notes.txt', content: text },
        { op: 'write', path: '/project/pixel.bin', content_base64: Buffer.from([137, 80, 78, 71, 0, 1]).toString('base64') },
        { op: 'write', path: '/draft.md', content: '# draft' },
        { op: 'move', from: '/draft.md', to: '/project/plan.md' },
      ],
    });
    expect(w.isError).toBeFalsy();
    const d = w.structuredContent!;
    expect(d.outcome).toBe('committed');
    expect(w.content[0].text).toContain('Created folder /project · Wrote /project/notes.txt');
    expect(w.content.filter((x) => x.type === 'resource_link')).toHaveLength(5);
    expect(JSON.parse(w.content.at(-1)!.text)).toEqual(d);

    // Paging across multi-byte characters never yields U+FFFD.
    let offset: number | null = 0;
    let got = '';
    while (offset !== null) {
      const r = await call(c, 'read_files', { paths: ['/project/notes.txt'], offset, max_bytes: 7 });
      const f = r.structuredContent!.files[0];
      expect(f.content).not.toContain('�');
      got += f.content;
      offset = f.next_offset;
    }
    expect(got).toBe(text);

    const s = await call(c, 'search_files', { query: 'plan' });
    expect(s.structuredContent!.results.map((x: Json) => x.path)).toEqual(['/project/plan.md']);
    const h = await call(c, 'get_history', { limit: 3 });
    expect(h.structuredContent!.entries[0].by).toEqual({ type: 'agent', name: 'E2E writer' });
    const df = await call(c, 'diff', { from: head0, to: 'now' });
    const plan = df.structuredContent!.changes.find((x: Json) => x.path === '/project/plan.md');
    expect(plan.diff).toContain('+# draft');
    const fv = await call(c, 'file_versions', { path: '/project/notes.txt' });
    expect(fv.structuredContent!.versions).toHaveLength(1);
    const cp = await call(c, 'create_checkpoint', { name: 'Project set up' });
    expect(cp.structuredContent!.checkpoint.name).toBe('Project set up');

    // A second edit, then a restore of that file, then undo the restore.
    const head1 = (await call(c, 'open_workspace')).structuredContent!.head_commit_id;
    await call(c, 'write_changes', { last_seen_commit_id: head1, changes: [{ op: 'write', path: '/project/plan.md', content: '# v2' }] });
    const re = await call(c, 'restore', { at: head1, paths: ['/project/plan.md'] });
    expect(re.structuredContent!.outcome).toBe('committed');
    const un = await call(c, 'undo');
    expect(un.structuredContent!.undone_action_id).toBe(re.structuredContent!.action_id);
    const now = await call(c, 'read_files', { paths: ['/project/plan.md'] });
    expect(now.structuredContent!.files[0].content).toBe('# v2');

    // A stale read of a touched file is refused.
    const stale = await call(c, 'write_changes', { last_seen_commit_id: head1, changes: [{ op: 'write', path: '/project/plan.md', content: 'mine' }] });
    expect(stale.isError).toBe(true);
    const err = JSON.parse(stale.content[0].text).error;
    expect(err.code).toBe('stale_base');
    expect(err.details.outcome).toBe('not_committed');
    await c.close();
  }, 60_000);

  test('review mode: propose, the owner accepts, the agent sees it', async () => {
    const { secret } = await token('drive:propose', 'review', 'E2E reviewer');
    const c = await connect(secret);
    expect((await c.listTools()).tools).toHaveLength(10);
    const head = (await call(c, 'open_workspace')).structuredContent!.head_commit_id;
    const w = await call(c, 'write_changes', { last_seen_commit_id: head, message: 'Suggest a readme', changes: [{ op: 'write', path: '/README.md', content: 'hi' }] });
    expect(w.structuredContent!.outcome).toBe('proposed');
    expect(w.structuredContent!.proposal_url).toBe(`${base}/proposals/${w.structuredContent!.proposal_id}?ws=${wsId}`);
    const id = w.structuredContent!.proposal_id;
    const acc = await owner('POST', `/api/w/${wsId}/proposals/${id}/accept`, {});
    expect(acc.status).toBe(200);
    const lp = await call(c, 'list_proposals', { proposal_id: id });
    expect(lp.structuredContent!.proposals[0].status).toBe('accepted');
    expect(lp.structuredContent!.proposals[0].accepted_action_ids).toEqual([acc.body.action.id]);
    await c.close();
  }, 60_000);

  test('revocation, origin, method and size limits at the endpoint', async () => {
    const t = await token('drive:read', 'review', 'E2E short-lived');
    const c = await connect(t.secret);
    expect((await c.listTools()).tools).toHaveLength(8);
    await c.close();
    if (t.id) expect((await owner('DELETE', `/api/agents/tokens/${t.id}`)).status).toBe(204);
    else await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.name, 'E2E short-lived'));
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
    const revoked = await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, authorization: `Bearer ${t.secret}` }, body: rpc });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get('www-authenticate')).toContain('resource_metadata=');

    const live = await token('drive:read', 'review', 'E2E live');
    const auth = { ...headers, authorization: `Bearer ${live.secret}` };
    const evil = await fetch(base + '/mcp', { method: 'POST', headers: { ...auth, origin: 'https://evil.example' }, body: rpc });
    expect(evil.status).toBe(403);
    const get = await fetch(base + '/mcp', { headers: auth });
    expect(get.status).toBe(405);
    // Own connection: the server answers before reading the whole body, so the socket is not reusable afterwards.
    const huge = await fetch(base + '/mcp', { method: 'POST', headers: { ...auth, connection: 'close' }, body: new Uint8Array(40 * 1024 * 1024), keepalive: false });
    expect(huge.status).toBe(413);
  }, 60_000);
});

describe('guard, links and review decisions over Streamable HTTP', () => {
  const head = async (c: Client) => (await call(c, 'open_workspace')).structuredContent!.head_commit_id as string;

  test('the guard blocks only changes to files someone else touched; get_links resolves drive URLs', async () => {
    const { secret } = await token('drive:write', 'direct', 'E2E guard');
    const c = await connect(secret);
    const w0 = await call(c, 'write_changes', {
      last_seen_commit_id: await head(c),
      changes: [
        { op: 'write', path: '/guard/mine.txt', content: 'mine v1' },
        { op: 'write', path: '/guard/theirs.txt', content: 'theirs v1' },
      ],
    });
    expect(w0.structuredContent!.outcome).toBe('committed');
    const seen = await head(c);

    // The owner deletes one file in the web app after the agent read the workspace.
    const del = await owner('POST', `/api/w/${wsId}/files/delete`, { paths: ['/guard/theirs.txt'] });
    expect(del.status).toBe(200);
    const after = await head(c);
    expect(after).not.toBe(seen);

    // A write to a file nobody else touched still lands on the stale read.
    const ok = await call(c, 'write_changes', { last_seen_commit_id: seen, changes: [{ op: 'write', path: '/guard/mine.txt', content: 'mine v2' }] });
    expect(ok.structuredContent!.outcome).toBe('committed');

    // A write to the file the owner deleted is refused with the conflict and the current head.
    const refused = await call(c, 'write_changes', { last_seen_commit_id: seen, changes: [{ op: 'write', path: '/guard/theirs.txt', content: 'theirs v2' }] });
    expect(refused.isError).toBe(true);
    const err = JSON.parse(refused.content[0].text).error;
    expect(err.code).toBe('stale_base');
    expect(err.details.outcome).toBe('not_committed');
    expect(err.details.conflicts).toEqual([expect.objectContaining({ path: '/guard/theirs.txt', reason: 'deleted' })]);
    expect(err.details.current_commit_id).toBe(await head(c));
    const gone = await owner('GET', `/api/w/${wsId}/files?path=${encodeURIComponent('/guard')}`);
    expect(gone.body.entries.map((e: Json) => e.name)).toEqual(['mine.txt']);

    const links = await call(c, 'get_links', { paths: ['/guard/mine.txt', '/guard', '/guard/nope.txt'] });
    const l = links.structuredContent!;
    expect(l.workspace_url.startsWith(base)).toBe(true);
    expect(l.links.map((x: Json) => [x.path, x.type, x.exists])).toEqual([
      ['/guard/mine.txt', 'file', true],
      ['/guard', 'dir', true],
      ['/guard/nope.txt', null, false],
    ]);
    expect(l.links[0].url).toContain(`ws=${wsId}`);
    expect(l.links[2].url).toBeNull();
    expect(links.content.filter((x) => x.type === 'resource_link').length).toBeGreaterThanOrEqual(3);
    await c.close();
  }, 60_000);

  test('an accepted proposal lands as one undoable action attributed to the agent', async () => {
    const { secret } = await token('drive:propose', 'review', 'E2E suggester');
    const c = await connect(secret);
    const before = await head(c);
    const w = await call(c, 'write_changes', {
      last_seen_commit_id: before,
      message: 'Draft the report',
      changes: [
        { op: 'mkdir', path: '/report' },
        { op: 'write', path: '/report/summary.md', content: '# Summary\n' },
        { op: 'write', path: '/report/data.csv', content: 'a,b\n1,2\n' },
      ],
    });
    const prop = w.structuredContent!;
    expect(prop.outcome).toBe('proposed');
    // Nothing reaches the drive until the owner accepts.
    expect(await head(c)).toBe(before);
    const detail = await owner('GET', `/api/w/${wsId}/proposals/${prop.proposal_id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.files.map((f: Json) => f.path)).toEqual(['/report', '/report/summary.md', '/report/data.csv']);
    const staged = await fetch(base + detail.body.files[1].compare.b.contentUrl, { headers: { cookie } });
    expect(await staged.text()).toBe('# Summary\n');

    const acc = await owner('POST', `/api/w/${wsId}/proposals/${prop.proposal_id}/accept`, {});
    expect(acc.status).toBe(200);
    expect(acc.body.proposal.status).toBe('accepted');
    const action = acc.body.action;
    expect(action.undoable).toBe(true);
    expect(action.agent).toMatchObject({ name: 'E2E suggester', kind: 'token' });

    const tl = await owner('GET', `/api/w/${wsId}/timeline`);
    const top = tl.body.entries[0];
    expect(top.actionId).toBe(action.id);
    expect(top.agent).toMatchObject({ name: 'E2E suggester' });
    expect(top.summary).toContain('Accepted from E2E suggester');
    const listed = await owner('GET', `/api/w/${wsId}/files?path=${encodeURIComponent('/report')}`);
    expect(listed.body.entries.map((e: Json) => e.name).sort()).toEqual(['data.csv', 'summary.md']);
    const content = await fetch(`${base}/api/w/${wsId}/files/content?path=${encodeURIComponent('/report/summary.md')}`, { headers: { cookie } });
    expect(await content.text()).toBe('# Summary\n');

    // One undo removes everything the proposal added, the folder included.
    const undo = await owner('POST', `/api/w/${wsId}/actions/${action.id}/undo`, {});
    expect(undo.status).toBe(200);
    const root = await owner('GET', `/api/w/${wsId}/files?path=%2F`);
    expect(root.body.entries.map((e: Json) => e.name)).not.toContain('report');
    const decided = await owner('GET', `/api/w/${wsId}/proposals/${prop.proposal_id}`);
    expect(decided.body.files.every((f: Json) => f.compare === null)).toBe(true);
    await c.close();
  }, 60_000);

  test('a discarded proposal changes nothing and the agent sees why', async () => {
    const { secret } = await token('drive:propose', 'review', 'E2E discarded');
    const c = await connect(secret);
    const before = await head(c);
    const w = await call(c, 'write_changes', { last_seen_commit_id: before, changes: [{ op: 'write', path: '/unwanted.md', content: 'no' }] });
    const id = w.structuredContent!.proposal_id;
    const count = await owner('GET', `/api/w/${wsId}/proposals/count`);
    expect(count.body.open).toBeGreaterThanOrEqual(1);
    const dis = await owner('POST', `/api/w/${wsId}/proposals/${id}/discard`, {});
    expect(dis.status).toBe(200);
    expect(dis.body.proposal.status).toBe('discarded');
    expect(await head(c)).toBe(before);
    const lp = await call(c, 'list_proposals', { proposal_id: id });
    expect(lp.structuredContent!.proposals[0].status).toBe('discarded');
    const again = await owner('POST', `/api/w/${wsId}/proposals/${id}/accept`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('proposal_closed');
    const staged = await fetch(`${base}/api/w/${wsId}/proposals/${id}/files/0/content`, { headers: { cookie } });
    expect(staged.status).toBe(404);
    await c.close();
  }, 60_000);
});
