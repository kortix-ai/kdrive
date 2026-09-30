// The MCP tools end to end through the in-process app (raw JSON-RPC on /mcp).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createAgentToken, makeApp, mcpCall, type Json } from '../../test/helpers';
import { endWorld, freshWorld, upload, user, type User } from '../../test/e2e/kit';

let u: User;
let secret: string;

async function call(name: string, args: Record<string, unknown> = {}, key = secret): Promise<Json> {
  const r = await mcpCall(makeApp(), key, 'tools/call', { name, arguments: args });
  if (r.status !== 200 || !r.body?.result) throw new Error(`tools/call ${name} → ${r.status} ${r.text.slice(0, 500)}`);
  return r.body.result as Json;
}

function errorOf(res: Json): Json {
  expect(res.isError).toBe(true);
  expect(res.structuredContent).toBeUndefined();
  return JSON.parse(res.content[0].text).error;
}

beforeEach(async () => {
  await freshWorld();
  u = await user('mcp-tools@test.local');
  secret = await createAgentToken(u.userId, { scope: 'drive:write', mode: 'direct', name: 'Tool agent' });
});
afterAll(() => endWorld());

describe('read tools', () => {
  test('tools/list for write+direct has 13 tools', async () => {
    const r = await mcpCall(makeApp(), secret, 'tools/list');
    expect(r.status).toBe(200);
    expect(r.body!.result.tools).toHaveLength(13);
  });

  test('list_workspaces and open_workspace', async () => {
    await upload(u, { '/docs/a.txt': 'hello', '/docs/deep/b.md': '# b', '/top.csv': 'x,y' });
    const lw = await call('list_workspaces');
    expect(lw.structuredContent.workspaces).toHaveLength(1);
    expect(lw.structuredContent.default_workspace_id).toBe(u.ws);
    expect(lw.content[0].text).toContain('1 workspace · default:');
    expect(JSON.parse(lw.content.at(-1).text)).toEqual(lw.structuredContent);
    const ow = await call('open_workspace');
    const d = ow.structuredContent;
    expect(d.file_count).toBe(3);
    expect(d.folder_count).toBe(2);
    expect(d.manifest.map((m: Json) => m.path)).toEqual(['/docs', '/top.csv', '/docs/deep', '/docs/a.txt', '/docs/deep/b.md']);
    expect(d.head_commit_id).toMatch(/^vc_/);
    expect(d.access).toEqual({ scope: 'drive:write', mode: 'direct', restricted_to: null });
    const small = await call('open_workspace', { max_entries: 2 });
    expect(small.structuredContent.manifest_truncated).toBe(true);
    expect(small.structuredContent.total_entries).toBe(5);
  });

  test('read_files pages text on UTF-8 boundaries, lists folders and marks binaries', async () => {
    const text = 'é'.repeat(100); // 200 bytes of 2-byte characters
    await upload(u, { '/t.txt': text, '/bin.dat': new Uint8Array([0, 1, 2, 3, 255]), '/d/x.txt': 'x' });
    let offset = 1; // mid-character on purpose
    let got = '';
    let first = true;
    for (let i = 0; i < 50 && offset !== null; i++) {
      const r = await call('read_files', { paths: ['t.txt'], offset, max_bytes: 33 });
      const f = r.structuredContent.files[0];
      expect(f.content).not.toContain('�');
      if (first) expect(f.offset).toBe(2);
      first = false;
      got += f.content;
      offset = f.next_offset;
    }
    expect(got).toBe('é'.repeat(99));
    const r = await call('read_files', { paths: ['/bin.dat', '/d', '/missing'] });
    const [bin, dir, missing] = r.structuredContent.files;
    expect(bin.binary).toBe(true);
    expect(bin.download_url).toContain('/files/content?');
    expect(dir.entries.map((e: Json) => e.name)).toEqual(['x.txt']);
    expect(missing.exists).toBe(false);
    expect(r.content[0].text).toBe('Read 1 file · 1 folder · 1 missing');
    const b64 = await call('read_files', { paths: ['/bin.dat'], encoding: 'base64' });
    expect(Buffer.from(b64.structuredContent.files[0].content, 'base64')).toEqual(Buffer.from([0, 1, 2, 3, 255]));
    const bad = errorOf(await call('read_files', { paths: ['/t.txt', '/bin.dat'], offset: 3 }));
    expect(bad.code).toBe('bad_request');
  });

  test('read_files folder listings share one bounded budget per call and page with offset', async () => {
    const long = 'n'.repeat(180);
    const dirs: string[] = [];
    for (let i = 0; i < 600; i++) dirs.push(`/a/${long}${String(i).padStart(4, '0')}`, `/b/${long}${String(i).padStart(4, '0')}`);
    await upload(u, {}, { dirs });
    const r = await call('read_files', { paths: ['/a', '/b'], max_bytes: 1 });
    const [a, b] = r.structuredContent.files;
    const n = a.entries.length + b.entries.length;
    expect(n).toBeLessThanOrEqual(1000);
    expect(a.entries_truncated || b.entries_truncated).toBe(true);
    expect(r.structuredContent.budget_exhausted).toBe(true);
    const bytes = [...a.entries, ...b.entries].reduce((s: number, e: Json) => s + e.name.length + e.path.length, 0);
    expect(bytes).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.stringify(r).length).toBeLessThan(1024 * 1024);
    // One folder at a time pages through every entry.
    const seen: string[] = [];
    let offset: number | null = 0;
    for (let i = 0; i < 20 && offset !== null; i++) {
      const page: Json = (await call('read_files', { paths: ['/a'], offset })).structuredContent.files[0];
      expect(page.offset).toBe(offset);
      seen.push(...page.entries.map((e: Json) => e.name));
      offset = page.next_offset;
    }
    expect(seen).toHaveLength(600);
    expect(new Set(seen).size).toBe(600);
  });

  test('search_files, get_history, file_versions, get_links', async () => {
    await upload(u, { '/plans/plan.md': 'v1' });
    await upload(u, { '/plans/plan.md': 'v2' });
    const s = await call('search_files', { query: 'plan' });
    expect(s.structuredContent.results.map((x: Json) => x.path)).toEqual(['/plans', '/plans/plan.md']);
    const h = await call('get_history', { limit: 5 });
    expect(h.structuredContent.entries[0].by.type).toBe('user');
    const v = await call('file_versions', { path: '/plans/plan.md' });
    expect(v.structuredContent.versions).toHaveLength(2);
    expect(v.structuredContent.versions[0].compare_url).toContain('/compare?');
    const l = await call('get_links', { paths: ['/plans/plan.md', '/nope'] });
    expect(l.structuredContent.links[0].url).toContain('file=plan.md');
    expect(l.structuredContent.links[1]).toEqual({ path: '/nope', type: null, exists: false, url: null });
  });
});

describe('write tools (direct)', () => {
  test('write_changes lands one agent action; diff, checkpoint, restore and undo work on it', async () => {
    await upload(u, { '/notes/old.txt': 'old\n' });
    const head0 = (await call('open_workspace')).structuredContent.head_commit_id;
    const w = await call('write_changes', {
      last_seen_commit_id: head0,
      changes: [
        { op: 'mkdir', path: '/out' },
        { op: 'write', path: 'out/a.md', content: '# A\nline\n' },
        { op: 'write', path: '/out/b.bin', content_base64: Buffer.from([1, 2, 3]).toString('base64') },
        { op: 'move', from: '/notes/old.txt', to: '/out/old.txt' },
      ],
    });
    const d = w.structuredContent;
    expect(d.outcome).toBe('committed');
    expect(d.changes.map((c: Json) => c.result)).toEqual(['folder', 'created', 'created', 'moved']);
    expect(w.content[0].text).toBe('Created folder /out · Wrote /out/a.md · Wrote /out/b.bin · Moved /notes/old.txt → /out/old.txt');
    expect(w.content.filter((c: Json) => c.type === 'resource_link')).toHaveLength(4);
    expect(JSON.parse(w.content.at(-1).text)).toEqual(d);
    expect(d.commit_ids.length).toBeGreaterThan(0);

    const h = await call('get_history', { limit: 2 });
    expect(h.structuredContent.entries[0].by).toEqual({ type: 'agent', name: 'Tool agent' });
    expect(h.structuredContent.entries[0].action_id).toBe(d.action_id);

    const df = await call('diff', { from: head0 });
    expect(df.structuredContent.counts.added).toBeGreaterThanOrEqual(2);
    const a = df.structuredContent.changes.find((c: Json) => c.path === '/out/a.md');
    expect(a.diff).toContain('+# A');
    expect(df.content[0].text).toContain(`from ${head0} to now`);

    const cp = await call('create_checkpoint', { name: 'Draft ready' });
    expect(cp.structuredContent.checkpoint.name).toBe('Draft ready');
    const since = await call('diff', { from: 'latest_checkpoint' });
    expect(since.structuredContent.changes).toHaveLength(0);

    const re = await call('restore', { at: head0, paths: ['/notes/old.txt'] });
    expect(re.structuredContent.outcome).toBe('committed');
    const back = await call('read_files', { paths: ['/notes/old.txt'] });
    expect(back.structuredContent.files[0].content).toBe('old\n');

    const un = await call('undo');
    expect(un.structuredContent.undone_action_id).toBe(re.structuredContent.action_id);
    const un2 = await call('undo');
    expect(un2.structuredContent.undone_action_id).toBe(d.action_id);
    const gone = await call('read_files', { paths: ['/out/a.md', '/notes/old.txt'] });
    expect(gone.structuredContent.files[0].exists).toBe(false);
    expect(gone.structuredContent.files[1].exists).toBe(true);
  });

  test('stale_base on a touched file; untouched changes never block; identical writes are unchanged', async () => {
    await upload(u, { '/a.txt': 'a', '/b.txt': 'b' });
    const base = (await call('open_workspace')).structuredContent.head_commit_id;
    await upload(u, { '/b.txt': 'b2' });
    const ok1 = await call('write_changes', { last_seen_commit_id: base, changes: [{ op: 'write', path: '/a.txt', content: 'a2' }] });
    expect(ok1.structuredContent.outcome).toBe('committed');
    const err = errorOf(await call('write_changes', { last_seen_commit_id: base, changes: [{ op: 'write', path: '/b.txt', content: 'mine' }] }));
    expect(err.code).toBe('stale_base');
    expect(err.details.outcome).toBe('not_committed');
    expect(err.details.conflicts[0]).toMatchObject({ path: '/b.txt', reason: 'changed' });
    expect(err.details.current_commit_id).toMatch(/^vc_/);
    expect(err.hint).toContain('Re-read them');
    const same = await call('write_changes', {
      last_seen_commit_id: err.details.current_commit_id,
      changes: [{ op: 'write', path: '/b.txt', content: 'b2' }],
    });
    expect(same.structuredContent.outcome).toBe('unchanged');
    expect(same.structuredContent.changes[0].result).toBe('unchanged');
  });

  test('last_seen_commit_id must be a commit id: "head" or a checkpoint never skips the guard', async () => {
    await upload(u, { '/plan.md': 'v1' });
    const head0 = (await call('open_workspace')).structuredContent.head_commit_id;
    await call('create_checkpoint', { name: 'Draft' });
    await upload(u, { '/plan.md': 'user edit' });
    const stale = errorOf(await call('write_changes', { last_seen_commit_id: head0, changes: [{ op: 'write', path: '/plan.md', content: 'agent' }] }));
    expect(stale.code).toBe('stale_base');
    for (const ref of ['head', 'Draft', 'HEAD']) {
      const e = errorOf(await call('write_changes', { last_seen_commit_id: ref, changes: [{ op: 'write', path: '/plan.md', content: 'agent' }] }));
      expect(e.code).toBe('bad_request');
      expect(e.details.outcome).toBe('not_committed');
      expect(e.message).toContain('commit id');
    }
    const r = await call('read_files', { paths: ['/plan.md'] });
    expect(r.structuredContent.files[0].content).toBe('user edit');
    const okd = await call('write_changes', { last_seen_commit_id: r.structuredContent.commit_id, changes: [{ op: 'write', path: '/plan.md', content: 'merged' }] });
    expect(okd.structuredContent.base_commit_id).toBe(r.structuredContent.commit_id);
  });

  test('a checkpoint that cannot be saved never reports the landed change as not committed', async () => {
    const { getStore } = await import('../storage');
    const { getWorkspaceForUser } = await import('../services/workspaces');
    const ws = (await getWorkspaceForUser(u.userId, u.ws))!;
    await upload(u, { '/a.txt': 'a' });
    for (let i = 0; i < 100; i++) await getStore().putTag(ws.volumeId, `cp-fill${i}`, 'head');
    const head = (await call('open_workspace')).structuredContent.head_commit_id;
    const w = await call('write_changes', { last_seen_commit_id: head, checkpoint: true, checkpoint_name: 'cp', changes: [{ op: 'write', path: '/b.txt', content: 'b' }] });
    expect(w.isError).toBeUndefined();
    const d = w.structuredContent;
    expect(d.outcome).toBe('committed');
    expect(d.action_id).toMatch(/^[0-9a-z]{26}$/);
    expect(d.checkpoint).toBeNull();
    expect(d.checkpoint_error).toContain('checkpoints and pinned links are in use');
    expect(d.summary).toContain('checkpoint not saved');
    const r = await call('read_files', { paths: ['/b.txt'] });
    expect(r.structuredContent.files[0].content).toBe('b');
  });

  test('restore and undo that change nothing say so and name no action', async () => {
    await upload(u, { '/a.txt': 'a' });
    const head = (await call('open_workspace')).structuredContent.head_commit_id;
    for (const args of [{ at: head, paths: ['/a.txt'] }, { at: head }]) {
      const r = await call('restore', args);
      expect(r.isError).toBeUndefined();
      expect(r.structuredContent).toMatchObject({ outcome: 'unchanged', action_id: null, head_commit_id: head });
      expect(r.content[0].text).toContain('Already at that version');
    }
    const h = await call('get_history', { limit: 5 });
    expect(h.structuredContent.head_commit_id).toBe(head);
  });

  test('checkpoint names and ids work wherever a version is asked for', async () => {
    await upload(u, { '/r.md': 'draft one' });
    const cp = (await call('create_checkpoint', { name: 'Research summary draft' })).structuredContent.checkpoint;
    await upload(u, { '/r.md': 'draft two' });
    for (const ref of ['Research summary draft', cp.id, cp.commit_id]) {
      const d = await call('diff', { from: ref, paths: ['/r.md'] });
      expect(d.isError).toBeUndefined();
      expect(d.structuredContent.from.commit_id).toBe(cp.commit_id);
      const r = await call('read_files', { paths: ['/r.md'], at: ref });
      expect(r.structuredContent.files[0].content).toBe('draft one');
    }
    const again = await call('create_checkpoint', { name: 'Pinned again', at: 'Research summary draft' });
    expect(again.structuredContent.checkpoint.commit_id).toBe(cp.commit_id);
    const s = await call('search_files', { query: 'r.md', at: 'Research summary draft' });
    expect(s.structuredContent.commit_id).toBe(cp.commit_id);
    const re = await call('restore', { at: 'Research summary draft', paths: ['/r.md'] });
    expect(re.structuredContent.outcome).toBe('committed');
    expect((await call('read_files', { paths: ['/r.md'] })).structuredContent.files[0].content).toBe('draft one');
    const unknown = errorOf(await call('diff', { from: 'No such checkpoint' }));
    expect(unknown.code).toBe('not_found');
    expect(unknown.message).toContain('No version called');
    const traversal = errorOf(await call('read_files', { paths: ['/r.md'], at: '../../etc' }));
    expect(traversal.code).toBe('not_found');
  });

  test('argument validation carries the op index and writes nothing', async () => {
    const head = (await call('open_workspace')).structuredContent.head_commit_id;
    const e1 = errorOf(
      await call('write_changes', { last_seen_commit_id: head, changes: [{ op: 'mkdir', path: '/ok' }, { op: 'write', path: '/x', content: 'a', content_base64: 'YQ==' }] }),
    );
    expect(e1).toMatchObject({ code: 'bad_request', details: { index: 1, outcome: 'not_committed' } });
    const e2 = errorOf(await call('write_changes', { last_seen_commit_id: head, changes: [{ op: 'write', path: '/x', content_base64: 'not base64!' }] }));
    expect(e2.details.index).toBe(0);
    const e3 = errorOf(await call('write_changes', { last_seen_commit_id: head, changes: [{ op: 'delete', path: '/missing' }] }));
    expect(e3).toMatchObject({ code: 'path_not_found', details: { index: 0 } });
    const e4 = errorOf(await call('write_changes', { last_seen_commit_id: 'vc_00000000000000000000000000', changes: [{ op: 'mkdir', path: '/y' }] }));
    expect(e4.code).toBe('stale_base');
    const e5 = errorOf(await call('write_changes', { last_seen_commit_id: head, checkpoint: true, changes: [{ op: 'mkdir', path: '/y' }] }));
    expect(e5.code).toBe('bad_request');
    const list = await call('read_files', { paths: ['/ok', '/y'] });
    expect(list.structuredContent.files.every((f: Json) => !f.exists)).toBe(true);
  });
});

describe('review mode', () => {
  test('a proposed folder move links each change to its row on the review page', async () => {
    const key = await createAgentToken(u.userId, { scope: 'drive:propose', name: 'Mover agent' });
    await upload(u, { '/docs/a.md': 'a' });
    const head = (await call('open_workspace', {}, key)).structuredContent.head_commit_id;
    const w = await call(
      'write_changes',
      { last_seen_commit_id: head, changes: [{ op: 'move', from: '/docs', to: '/archive/docs' }, { op: 'write', path: '/Documents/follow-ups.md', content: 'f' }] },
      key,
    );
    const d = w.structuredContent;
    expect(d.changes.map((c: Json) => c.url)).toEqual([`${d.proposal_url}&seq=0`, `${d.proposal_url}&seq=1`]);
    expect(JSON.stringify(w.content)).not.toContain('/drive/');
  });

  test('write_changes proposes; list_proposals follows the decision', async () => {
    const key = await createAgentToken(u.userId, { scope: 'drive:propose', name: 'Reviewer agent' });
    const tools = await mcpCall(makeApp(), key, 'tools/list');
    expect(tools.body!.result.tools).toHaveLength(10);
    const head = (await call('open_workspace', {}, key)).structuredContent.head_commit_id;
    const w = await call('write_changes', { last_seen_commit_id: head, message: 'Add plan', changes: [{ op: 'write', path: '/plan.md', content: 'p' }] }, key);
    expect(w.structuredContent.outcome).toBe('proposed');
    expect(w.structuredContent.proposal_url).toContain('/proposals/');
    expect(w.content[0].text).toBe('Proposed 1 change for review · waiting for the user');
    // Nothing is in the drive yet: every link goes to the review page, never to a drive path.
    expect(w.content.filter((c: Json) => c.type === 'resource_link').map((c: Json) => c.uri)).toEqual([w.structuredContent.proposal_url]);
    expect(w.structuredContent.changes[0].url).toBe(`${w.structuredContent.proposal_url}&seq=0`);
    const nothing = await call('read_files', { paths: ['/plan.md'] }, key);
    expect(nothing.structuredContent.files[0].exists).toBe(false);
    const id = w.structuredContent.proposal_id;
    const acc = await u.client.post(`/api/w/${u.ws}/proposals/${id}/accept`, {});
    expect(acc.status).toBe(200);
    const lp = await call('list_proposals', { proposal_id: id }, key);
    const pr = lp.structuredContent.proposals[0];
    expect(pr.status).toBe('accepted');
    expect(pr.accepted_action_ids).toEqual([acc.body.action.id]);
    expect(pr.files[0].status).toBe('accepted');
    const other = errorOf(await call('list_proposals', { proposal_id: id }));
    expect(other.code).toBe('not_found');
  });
});

describe('change card', () => {
  test('is listed and read as a self-contained app page', async () => {
    const { DIFF_CARD_HTML, DIFF_CARD_URI } = await import('./diff-card');
    const list = await mcpCall(makeApp(), secret, 'resources/list');
    expect(list.body!.result.resources.map((r: Json) => r.uri)).toEqual([DIFF_CARD_URI]);
    const read = await mcpCall(makeApp(), secret, 'resources/read', { uri: DIFF_CARD_URI });
    const c = read.body!.result.contents[0];
    expect(c.mimeType).toBe('text/html;profile=mcp-app');
    expect(c._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    expect(c.text).toBe(DIFF_CARD_HTML);
    expect(new TextEncoder().encode(DIFF_CARD_HTML).length).toBeLessThan(30 * 1024);
    expect(DIFF_CARD_HTML).not.toMatch(/https?:\/\//);
    expect(DIFF_CARD_HTML).not.toContain('innerHTML');
    const script = DIFF_CARD_HTML.slice(DIFF_CARD_HTML.indexOf('<script>') + 8, DIFF_CARD_HTML.indexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('argument errors', () => {
  test('schema failures come back in the JSON error shape', async () => {
    const e = errorOf(await call('read_files', {}));
    expect(e.code).toBe('bad_request');
    expect(e.message).toContain('Input validation error');
    const w = errorOf(await call('write_changes', { changes: [] }));
    expect(w.details.outcome).toBe('not_committed');
    const r = await mcpCall(makeApp(), await createAgentToken(u.userId, { scope: 'drive:read' }), 'tools/call', { name: 'undo', arguments: {} });
    const unknown = errorOf(r.body!.result);
    expect(unknown.code).toBe('not_found');
  });
});
