import { beforeEach, describe, expect, test } from 'bun:test';
import type { MeResponse } from '@volumes/shared';
import { api } from './api/endpoints';
import { useVx } from './store';

const me: MeResponse = {
  user: { id: 'u1', email: 'a@b.c', name: 'A', image: null, emailVerified: true },
  isAdmin: false,
  defaultWorkspaceId: 'ws-default',
  workspaces: [
    { id: 'ws-default', name: 'My Drive', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', usageBytes: 0, forkedFrom: null, role: 'owner' as const, owner: null },
    { id: 'ws-2', name: 'Copy', isDefault: false, createdAt: '2026-01-02T00:00:00.000Z', usageBytes: 0, forkedFrom: null, role: 'owner' as const, owner: null },
  ],
  usage: { quotaBytes: 10, usedBytes: 0, level: 'ok', byWorkspace: [] },
};

describe('store', () => {
  beforeEach(() => {
    useVx.setState({ me: null, workspaceId: null, selection: [], anchor: null, panel: null, timeTravel: null, toasts: [], undoStack: [] });
  });

  test('setMe picks the default workspace; setWorkspace resets view state', () => {
    const s = useVx.getState();
    s.setMe(me);
    expect(useVx.getState().workspaceId).toBe('ws-default');
    s.select(['/a']);
    s.enterTimeTravel({ commitId: 'vc_1', createdAt: 'x' });
    s.openPreview('/a');
    expect(useVx.getState().panel).toEqual({ kind: 'preview', path: '/a', at: 'vc_1' });
    const k = useVx.getState().refreshKey;
    s.setWorkspace('ws-2');
    const after = useVx.getState();
    expect(after.workspaceId).toBe('ws-2');
    expect(after.selection).toEqual([]);
    expect(after.panel).toBeNull();
    expect(after.timeTravel).toBeNull();
    expect(after.refreshKey).toBe(k + 1);
  });

  test('selection modes', () => {
    const s = useVx.getState();
    s.select(['/a', '/b']);
    s.select(['/b', '/c'], 'toggle');
    expect(useVx.getState().selection.sort()).toEqual(['/a', '/c']);
    s.select(['/d'], 'add');
    expect(useVx.getState().selection.sort()).toEqual(['/a', '/c', '/d']);
    s.clearSelection();
    expect(useVx.getState().selection).toEqual([]);
  });

  test('toasts cap at 3; registerUndo pushes an undo entry + an undo toast', () => {
    const s = useVx.getState();
    s.setMe(me);
    for (let i = 0; i < 5; i++) s.toast({ message: `t${i}` });
    expect(useVx.getState().toasts.map((t) => t.message)).toEqual(['t2', 't3', 't4']);
    s.registerUndo({ label: 'Deleted 3 items', actionId: 'act1' });
    const st = useVx.getState();
    expect(st.undoStack.at(-1)).toMatchObject({ actionId: 'act1', workspaceId: 'ws-default' });
    expect(st.toasts.at(-1)).toMatchObject({ message: 'Deleted 3 items', undoActionId: 'act1', durationMs: 8000 });
    for (const t of st.toasts) s.dismissToast(t.id);
    expect(useVx.getState().toasts).toEqual([]);
  });

  test('dialog targets open and close', () => {
    const s = useVx.getState();
    s.openRestore({ scope: 'drive', at: 'vc_1' });
    expect(useVx.getState().restore).toEqual({ scope: 'drive', at: 'vc_1' });
    s.closeRestore();
    s.openCheckpoint();
    expect(useVx.getState().checkpoint).toEqual({ at: null });
    s.openShare('/x');
    expect(useVx.getState().share).toEqual({ path: '/x' });
  });

  test('the current workspace deleted elsewhere: falls back to the default and drops everything about the old one', () => {
    const s = useVx.getState();
    s.setMe(me);
    s.setWorkspace('ws-2');
    s.setPath('/reports');
    s.enterTimeTravel({ commitId: 'vc_ws2', createdAt: 'x' });
    s.select(['/reports/q3.pdf']);
    s.openPreview('/reports/q3.pdf');
    s.openRestore({ scope: 'file', path: '/reports/q3.pdf', at: 'vc_ws2' });
    s.openShare('/reports/q3.pdf');
    const k = useVx.getState().refreshKey;
    // `me` revalidates without ws-2 (deleted in another tab, or by an admin)
    s.setMe({ ...me, workspaces: [me.workspaces[0]] });
    const st = useVx.getState();
    expect(st.workspaceId).toBe('ws-default');
    expect({ selection: st.selection, anchor: st.anchor, timeTravel: st.timeTravel, panel: st.panel, path: st.path, restore: st.restore, share: st.share }).toEqual({
      selection: [],
      anchor: null,
      timeTravel: null,
      panel: null,
      path: '/',
      restore: null,
      share: null,
    });
    expect(st.refreshKey).toBe(k + 1);
    // a revalidation that keeps the workspace changes nothing
    s.select(['/a']);
    s.setMe({ ...me, workspaces: [me.workspaces[0]] });
    expect(useVx.getState().selection).toEqual(['/a']);
  });

  test('redo from the "Undone" toast goes to the workspace the action ran in, not the selected one', async () => {
    const calls: string[] = [];
    const orig = api.versioning.undo;
    let n = 0;
    (api.versioning as { undo: unknown }).undo = async (w: string, actionId: string) => {
      calls.push(`${w}:${actionId}`);
      return { action: { id: `redo-${++n}`, undoable: true } } as never;
    };
    try {
      const s = useVx.getState();
      s.setMe(me);
      s.setWorkspace('ws-2');
      // an upload that ran in ws-default finished after the switch
      s.registerUndo({ label: 'Uploaded', actionId: 'act-up', workspaceId: 'ws-default' });
      await useVx.getState().undo('act-up');
      const undone = useVx.getState().toasts.find((t) => t.message === 'Undone')!;
      expect(undone.undoActionId).toBe('redo-1');
      await useVx.getState().undo(undone.id);
      // and again, from the next "Undone"
      const again = useVx.getState().toasts.find((t) => t.message === 'Undone' && t.undoActionId === 'redo-2')!;
      await useVx.getState().undo(again.id);
      expect(calls).toEqual(['ws-default:act-up', 'ws-default:redo-1', 'ws-default:redo-2']);
    } finally {
      (api.versioning as { undo: unknown }).undo = orig;
    }
  });
});
