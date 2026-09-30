// Move to… / Copy to… belongs to the workspace it was opened in: when that workspace
// goes away (deleted in another tab) and the drive falls back to another one, the open
// picker must not carry its request over and move files there.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { FileEntry } from '@volumes/shared';

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let MoveCopyDialog: typeof import('./move-copy-dialog').default;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The folder listing is never reached in these tests; keep fetch off the network.
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  MoveCopyDialog = (await import('./move-copy-dialog')).default;
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const entry: FileEntry = { path: '/payroll.xlsx', name: 'payroll.xlsx', type: 'file', size: 10, mtime: 0 };

describe('move/copy picker and the workspace in use', () => {
  test('a request made in another workspace is not shown for the current one', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let setWs: (ws: string) => void = () => {};
    function Host() {
      const [ws, set] = React.useState('ws-2');
      setWs = set;
      return <MoveCopyDialog ws={ws} rootName="My Drive" req={{ ws: 'ws-2', mode: 'move', entries: [entry], startDir: '/' }} onClose={() => {}} />;
    }
    await act(async () => root.render(<Host />));
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    // ws-2 was deleted elsewhere; the drive falls back to the default workspace.
    await act(async () => setWs('ws-default'));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.body.textContent).not.toContain('Move here');
    await act(async () => root.unmount());
    host.remove();
  });
});
