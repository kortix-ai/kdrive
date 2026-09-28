import { beforeEach, describe, expect, test } from 'bun:test';
import type { MeResponse } from '@volumes/shared';
import { useVx } from './store';

const me: MeResponse = {
  user: { id: 'u1', email: 'a@b.c', name: 'A', image: null },
  isAdmin: false,
  defaultWorkspaceId: 'ws-default',
  workspaces: [
    { id: 'ws-default', name: 'My Drive', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', usageBytes: 0, forkedFrom: null },
    { id: 'ws-2', name: 'Copy', isDefault: false, createdAt: '2026-01-02T00:00:00.000Z', usageBytes: 0, forkedFrom: null },
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
});
