// End to end: drive members. The owner invites by address, the invitee accepts,
// editors change files (counted against the owner's quota), viewers only read,
// and only the owner manages people.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { userSettings } from '../../src/db/schema';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, ls, text, timeline, upload, user, type User } from './kit';

let mail: Mailbox;
beforeEach(async () => {
  await freshWorld();
  mail = captureMail();
});
afterEach(() => {
  mail.restore();
  endWorld();
});
afterAll(endWorld);

/** `owner` invites `who` with `role`, and `who` accepts. Returns `who` pointed at the owner's drive. */
async function join(owner: User, who: User, role: 'editor' | 'viewer'): Promise<User> {
  const inv = await owner.client.post(`/api/workspaces/${owner.ws}/invites`, { email: who.me.user.email, role });
  expect(inv.status).toBe(201);
  const list = (await who.client.get('/api/invitations')).body.invitations;
  const mine = list.find((i: { workspaceId: string }) => i.workspaceId === owner.ws);
  expect(mine).toMatchObject({ role, invitedBy: { email: owner.me.user.email } });
  const acc = await who.client.post(`/api/invitations/${mine.id}/accept`, {});
  expect(acc.status).toBe(200);
  return { ...who, ws: owner.ws };
}

const setQuota = (u: User, bytes: number) => db.update(userSettings).set({ quotaBytes: bytes }).where(eq(userSettings.userId, u.userId));

describe('invitations', () => {
  test('invite by address, mail with a link, accept, and the drive shows up as shared', async () => {
    const ada = await user('ada@test.local');
    const ben = await user('ben@test.local');
    await upload(ada, { '/plan.md': 'from ada' });

    // Before accepting, Ben cannot open the drive.
    expect((await ben.client.get(`/api/w/${ada.ws}/files`)).status).toBe(404);
    const benInAda = await join(ada, ben, 'editor');

    const sent = await mail.to('ben@test.local', 'drive-invite');
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('My Drive');
    expect(sent[0].links?.[0]).toContain('/drive?invitations=1');

    const me = (await ben.client.get('/api/me')).body;
    expect(me.workspaces.map((w: { name: string; role: string }) => `${w.name}:${w.role}`)).toEqual(['My Drive:owner', 'My Drive:editor']);
    const shared = me.workspaces[1];
    expect(shared).toMatchObject({ id: ada.ws, isDefault: false, owner: { email: 'ada@test.local' } });
    // Ada's bytes are not Ben's usage.
    expect(me.usage.byWorkspace).toHaveLength(1);

    expect(await text(benInAda, '/plan.md')).toBe('from ada');
    // The invitation is used up.
    expect((await ben.client.get('/api/invitations')).body.invitations).toEqual([]);
  });

  test('an invitation only works for the address it was sent to', async () => {
    const ada = await user('ada2@test.local');
    const eve = await user('eve@test.local');
    const inv = (await ada.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'carol@test.local', role: 'editor' })).body.invite;
    expect((await eve.client.get('/api/invitations')).body.invitations).toEqual([]);
    expect((await eve.client.post(`/api/invitations/${inv.id}/accept`, {})).status).toBe(404);
    expect((await eve.client.get(`/api/w/${ada.ws}/files`)).status).toBe(404);
    // Carol signs up later with that address and finds it waiting.
    const carol = await user('carol@test.local');
    expect((await carol.client.get('/api/invitations')).body.invitations).toHaveLength(1);
  });

  test('decline, revoke, re-invite and the obvious refusals', async () => {
    const ada = await user('ada3@test.local');
    const ben = await user('ben3@test.local');
    // Inviting yourself, or someone already in, is refused.
    expect((await ada.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'ADA3@test.local', role: 'viewer' })).body.error.code).toBe('already_member');

    const first = (await ada.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'ben3@test.local', role: 'viewer' })).body.invite;
    // Re-inviting the same address updates the one invitation.
    const again = (await ada.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'ben3@test.local', role: 'editor' })).body.invite;
    const people = (await ada.client.get(`/api/workspaces/${ada.ws}/people`)).body;
    expect(people.invites).toHaveLength(1);
    expect(people.invites[0]).toMatchObject({ email: 'ben3@test.local', role: 'editor' });
    expect(again.id).toBe(first.id);

    const inv = (await ben.client.get('/api/invitations')).body.invitations[0];
    expect((await ben.client.post(`/api/invitations/${inv.id}/decline`, {})).status).toBe(204);
    expect((await ada.client.get(`/api/workspaces/${ada.ws}/people`)).body.invites).toEqual([]);

    await ada.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'ben3@test.local', role: 'viewer' });
    const open = (await ada.client.get(`/api/workspaces/${ada.ws}/people`)).body.invites[0];
    expect((await ada.client.del(`/api/workspaces/${ada.ws}/invites/${open.id}`)).status).toBe(204);
    expect((await ben.client.get('/api/invitations')).body.invitations).toEqual([]);

    await join(ada, ben, 'viewer');
    expect((await ada.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'ben3@test.local', role: 'editor' })).body.error.code).toBe('already_member');
  });
});

describe('roles', () => {
  test('an editor changes files, attributed to them; the owner sees it', async () => {
    const ada = await user('ada4@test.local');
    const ben = await join(ada, await user('ben4@test.local'), 'editor');
    await upload(ben, { '/notes/ben.md': 'hello from ben' });
    expect((await ben.client.post(`/api/w/${ada.ws}/folders`, { path: '/shared' })).status).toBe(200);
    expect(await ls(ada)).toEqual(['notes/', 'shared/']);
    expect(await text(ada, '/notes/ben.md')).toBe('hello from ben');
    const entries = await timeline(ada);
    expect(entries[0].actor).toMatchObject({ email: 'ben4@test.local' });
  });

  test('a viewer reads everything and changes nothing', async () => {
    const ada = await user('ada5@test.local');
    await upload(ada, { '/a.txt': 'aaa' });
    const vic = await join(ada, await user('vic@test.local'), 'viewer');

    expect(await ls(vic)).toEqual(['a.txt']);
    expect(await text(vic, '/a.txt')).toBe('aaa');
    expect((await vic.client.get(`/api/w/${ada.ws}/timeline`)).status).toBe(200);

    const refused = [
      await vic.client.post(`/api/w/${ada.ws}/uploads`, { files: [], dirs: ['/x'], conflict: 'replace' }),
      await vic.client.post(`/api/w/${ada.ws}/folders`, { path: '/x' }),
      await vic.client.post(`/api/w/${ada.ws}/files/delete`, { paths: ['/a.txt'] }),
      await vic.client.post(`/api/w/${ada.ws}/links`, { path: '/a.txt', mode: 'live' }),
      await vic.client.post(`/api/w/${ada.ws}/checkpoints`, { name: 'mine' }),
      await vic.client.post(`/api/w/${ada.ws}/restore`, { scope: 'drive', at: 'head' }),
    ];
    for (const r of refused) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('read_only');
    }
    expect(await ls(ada)).toEqual(['a.txt']);
  });

  test('the owner changes a role and removes people; members cannot manage the drive', async () => {
    const ada = await user('ada6@test.local');
    const ben = await join(ada, await user('ben6@test.local'), 'editor');
    const cy = await join(ada, await user('cy6@test.local'), 'viewer');

    const people = (await ben.client.get(`/api/workspaces/${ada.ws}/people`)).body;
    expect(people.members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`)).toEqual([
      'ada6@test.local:owner',
      'ben6@test.local:editor',
      'cy6@test.local:viewer',
    ]);
    expect(people.invites).toEqual([]); // only the owner sees open invitations

    // Members cannot invite, change roles, remove others, rename, delete or duplicate the drive.
    expect((await ben.client.post(`/api/workspaces/${ada.ws}/invites`, { email: 'x@test.local', role: 'viewer' })).status).toBe(403);
    expect((await ben.client.patch(`/api/workspaces/${ada.ws}/members/${cy.userId}`, { role: 'editor' })).status).toBe(403);
    expect((await ben.client.del(`/api/workspaces/${ada.ws}/members/${cy.userId}`)).status).toBe(403);
    expect((await ben.client.patch(`/api/workspaces/${ada.ws}`, { name: 'Mine now' })).status).toBe(404);
    expect((await ben.client.del(`/api/workspaces/${ada.ws}`)).status).toBe(404);
    expect((await ben.client.post(`/api/workspaces/${ada.ws}/duplicate`, { name: 'Copy' })).status).toBe(404);

    // Editor → viewer: writes stop.
    expect((await ada.client.patch(`/api/workspaces/${ada.ws}/members/${ben.userId}`, { role: 'viewer' })).status).toBe(200);
    expect((await ben.client.post(`/api/w/${ada.ws}/folders`, { path: '/nope' })).status).toBe(403);

    // Removed: the drive is gone for them.
    expect((await ada.client.del(`/api/workspaces/${ada.ws}/members/${cy.userId}`)).status).toBe(204);
    expect((await cy.client.get(`/api/w/${ada.ws}/files`)).status).toBe(404);
    expect((await cy.client.get('/api/me')).body.workspaces).toHaveLength(1);
  });

  test('a member leaves; the owner cannot', async () => {
    const ada = await user('ada7@test.local');
    const ben = await join(ada, await user('ben7@test.local'), 'editor');
    expect((await ada.client.del(`/api/workspaces/${ada.ws}/members/${ada.userId}`)).status).toBe(400);
    expect((await ben.client.del(`/api/workspaces/${ada.ws}/members/${ben.userId}`)).status).toBe(204);
    expect((await ben.client.get(`/api/w/${ada.ws}/files`)).status).toBe(404);
  });

  test('deleting a drive ends everyone’s access and invitations', async () => {
    const ada = await user('ada8@test.local');
    const side = (await ada.client.post('/api/workspaces', { name: 'Side' })).body.workspace;
    const owner = { ...ada, ws: side.id as string };
    const ben = await join(owner, await user('ben8@test.local'), 'editor');
    await ada.client.post(`/api/workspaces/${side.id}/invites`, { email: 'later@test.local', role: 'viewer' });
    expect((await ada.client.del(`/api/workspaces/${side.id}`)).status).toBe(204);
    expect((await ben.client.get(`/api/w/${side.id}/files`)).status).toBe(404);
    const later = await user('later@test.local');
    expect((await later.client.get('/api/invitations')).body.invitations).toEqual([]);
  });
});

describe('quota', () => {
  test("a member's upload counts against the owner's quota, not their own", async () => {
    const ada = await user('ada9@test.local');
    const ben = await join(ada, await user('ben9@test.local'), 'editor');
    await setQuota(ada, 10_000);
    // 20,000 bytes into Ada's drive: over Ada's quota, whatever Ben's is.
    await expect(upload(ben, { '/big.bin': new Uint8Array(20_000) })).rejects.toThrow(/413/);
    await upload(ben, { '/small.bin': new Uint8Array(500) });
    expect((await ada.client.get('/api/me/usage')).body.usedBytes).toBeGreaterThan(0);
    expect((await ben.client.get('/api/me/usage')).body.usedBytes).toBe(0);
  });
});
