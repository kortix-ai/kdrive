import { beforeEach, describe, expect, test } from 'bun:test';
import { mutate } from 'swr';
import { cache } from 'swr/_internal';
import type { MeResponse } from '@volumes/shared';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { endSession } from './session';
import { useVx } from './store';
import { askConflict, showQuota, useUploadPrompts } from './upload/prompts';

const me: MeResponse = {
  user: { id: 'u1', email: 'a@b.c', name: 'A', image: null, emailVerified: true },
  isAdmin: false,
  defaultWorkspaceId: 'ws-default',
  workspaces: [
    { id: 'ws-default', name: 'My Drive', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', usageBytes: 0, forkedFrom: null },
    { id: 'ws-2', name: 'Copy', isDefault: false, createdAt: '2026-01-02T00:00:00.000Z', usageBytes: 0, forkedFrom: null },
  ],
  usage: { quotaBytes: 10, usedBytes: 0, level: 'ok', byWorkspace: [] },
};

describe('session', () => {
  beforeEach(() => {
    useVx.setState({ me: null, workspaceId: null, selection: [], anchor: null, panel: null, timeTravel: null, toasts: [], undoStack: [], uploads: [] });
    useUploadPrompts.setState({ conflict: null, quota: null });
  });

  test('an undo registered for another workspace (an upload that finished after a switch) keeps that workspace', () => {
    const s = useVx.getState();
    s.setMe(me);
    s.setWorkspace('ws-2');
    s.registerUndo({ label: 'Uploaded 3 files', actionId: 'act-up', workspaceId: 'ws-default' });
    expect(useVx.getState().undoStack.at(-1)).toMatchObject({ actionId: 'act-up', workspaceId: 'ws-default' });
    // without a workspace, it is the current one (as before)
    s.registerUndo({ label: 'Deleted a', actionId: 'act-del' });
    expect(useVx.getState().undoStack.at(-1)).toMatchObject({ actionId: 'act-del', workspaceId: 'ws-2' });
  });

  test('signing out forgets the user: store state and every cached response', async () => {
    const s = useVx.getState();
    s.setMe(me);
    s.select(['/a']);
    s.openPreview('/a');
    s.registerUndo({ label: 'Deleted a', actionId: 'act1' });
    s.openShare('/a');
    await mutate('me', me, false);
    await mutate('workspaces', { workspaces: me.workspaces }, false);
    cache.set('$inf$timeline', { data: [{ entries: [] }] });
    expect(cache.get('me')?.data).toEqual(me);

    await endSession();

    const st = useVx.getState();
    expect(st.me).toBeNull();
    expect(st.workspaceId).toBeNull();
    expect(st.selection).toEqual([]);
    expect(st.panel).toBeNull();
    expect(st.undoStack).toEqual([]);
    expect(st.share).toBeNull();
    expect(cache.get('me')?.data).toBeUndefined();
    expect(cache.get('workspaces')?.data).toBeUndefined();
    expect(cache.get('$inf$timeline')?.data).toBeUndefined();
  });

  test("signing out forgets the upload tray and any open upload question (the next person in this tab never sees them)", async () => {
    const s = useVx.getState();
    s.setMe(me);
    s.addUploadJob({
      id: 'job1',
      workspaceId: 'ws-default',
      basePath: '/',
      files: [{ id: 'f1', path: '/offer-letter.pdf', size: 10, hashed: 10, sent: 0, status: 'conflict' }],
      status: 'active',
      createdAt: Date.now(),
    });
    const pending = askConflict(['/offer-letter.pdf']);
    showQuota({ usedBytes: 1, quotaBytes: 2, requestedBytes: 3, overBytes: 2 }, 1);

    await endSession();

    expect(useVx.getState().uploads).toEqual([]);
    expect(useUploadPrompts.getState().conflict).toBeNull();
    expect(useUploadPrompts.getState().quota).toBeNull();
    // the engine waiting on the answer is told the upload is cancelled
    expect(await pending).toBeNull();
  });

  test('every sign-out path goes through the one session end (no component signs out on its own)', () => {
    const root = resolve(import.meta.dir, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const rel = relative(root, p);
          if (rel === 'lib/session.ts' || rel === 'lib/auth-client.ts' || rel === 'lib/store.ts') continue;
          const src = readFileSync(p, 'utf8');
          if (/setMe\(\s*null\s*\)/.test(src) || /\bsignOut\b/.test(src)) offenders.push(rel);
        }
      }
    };
    for (const d of ['app', 'components', 'lib']) walk(join(root, d));
    expect(offenders).toEqual([]);
  });
});
