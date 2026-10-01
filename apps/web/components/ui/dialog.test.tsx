// Dialog keyboard behaviour in a real DOM (happy-dom): ↵ acts only on what has focus when
// the key goes down, never on a key that was already held when the dialog opened.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let Dialog: typeof import('./dialog').Dialog;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ Dialog } = await import('./dialog'));
});

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  document.body.innerHTML = '';
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const tick = (ms = 5) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

const key = (el: EventTarget, type: 'keydown' | 'keyup', init: KeyboardEventInit = {}) =>
  act(() => void el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true, ...init })));

const label = (el: Element | null) => (el ? el.id || el.getAttribute('role') || el.tagName : 'none');
const focused = () => label(document.activeElement);

type Api = { rerender(): void; setOpen(v: boolean): void };

/** A page with an opener button and a dialog whose onSubmit/onClose are inline (new every render). */
async function mount(submits: { n: number }, initialOpen = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const api = {} as Api;
  function Host(): ReactNode {
    const [open, setOpen] = React.useState(initialOpen);
    const [, setN] = React.useState(0);
    api.rerender = () => setN((n) => n + 1);
    api.setOpen = setOpen;
    return (
      <>
        <button type="button" id="t-opener" onClick={() => setOpen(true)}>
          Open
        </button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Restore?"
          onSubmit={() => submits.n++}
          footer={
            <>
              <button type="button" id="t-cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" id="t-primary" onClick={() => submits.n++}>
                Restore
              </button>
            </>
          }
        >
          <p>Body</p>
        </Dialog>
      </>
    );
  }
  const root = createRoot(host);
  await act(async () => root.render(<Host />));
  await tick();
  let done = false;
  const unmount = async () => {
    if (done) return;
    done = true;
    await act(async () => root.unmount());
    host.remove();
  };
  mounted.push(unmount);
  return { api, unmount };
}

describe('dialog ↵ acts only on the element focused at keydown', () => {
  test('a re-render (inline onSubmit, SWR revalidate) keeps focus on Cancel; ↵ there does not submit', async () => {
    const submits = { n: 0 };
    const { api, unmount } = await mount(submits);
    const cancel = document.getElementById('t-cancel')!;
    cancel.focus();
    expect(focused()).toBe(label(cancel));
    await act(async () => api.rerender());
    await tick();
    expect(focused()).toBe(label(cancel));
    await key(document.activeElement!, 'keydown');
    await key(document.activeElement!, 'keyup');
    expect(submits.n).toBe(0);
    await unmount();
  });

  test('auto-repeat ↵ (key held) never submits; a fresh press does', async () => {
    const submits = { n: 0 };
    const { unmount } = await mount(submits);
    const box = document.querySelector('[role=dialog]')!;
    expect(focused()).toBe(label(box));
    await key(box, 'keydown', { repeat: true });
    expect(submits.n).toBe(0);
    await key(box, 'keydown');
    expect(submits.n).toBe(1);
    await unmount();
  });

  test('a ↵ that went down before the dialog opened does not submit, even without the repeat flag', async () => {
    const submits = { n: 0 };
    const { api, unmount } = await mount(submits, false);
    const opener = document.getElementById('t-opener')!;
    opener.focus();
    // the press that opens the dialog (the button acts on it)
    await key(opener, 'keydown');
    await act(async () => api.setOpen(true));
    await tick();
    const box = document.querySelector('[role=dialog]')!;
    expect(focused()).toBe(label(box));
    // held key: repeats, some without the flag (remote desktops, some IMEs)
    await key(box, 'keydown', { repeat: true });
    await key(box, 'keydown');
    expect(submits.n).toBe(0);
    await key(box, 'keyup');
    // a deliberate second press
    await key(box, 'keydown');
    expect(submits.n).toBe(1);
    await unmount();
  });

  test('closing returns focus to the opener, once', async () => {
    const submits = { n: 0 };
    const { api, unmount } = await mount(submits, false);
    const opener = document.getElementById('t-opener')!;
    opener.focus();
    await act(async () => api.setOpen(true));
    await tick();
    expect(focused()).toBe(label(document.querySelector('[role=dialog]')));
    await act(async () => api.setOpen(false));
    expect(focused()).toBe(label(opener));
    await unmount();
  });
  test('↵ after the focused row was replaced (focus fell to <body>) does not submit; focus goes back into the dialog', async () => {
    const submits = { n: 0 };
    const host = document.createElement('div');
    document.body.appendChild(host);
    let hideRow = () => {};
    function Host(): ReactNode {
      const [row, setRow] = React.useState(true);
      hideRow = () => setRow(false);
      return (
        <Dialog
          open
          onClose={() => {}}
          title="Move"
          onSubmit={() => submits.n++}
          footer={
            <>
              <button type="button" id="t-cancel">
                Cancel
              </button>
              <button type="button" id="t-primary" onClick={() => submits.n++}>
                Move here
              </button>
            </>
          }
        >
          {row ? (
            <div role="row" tabIndex={0} id="t-row">
              archive
            </div>
          ) : (
            <p>Loading…</p>
          )}
        </Dialog>
      );
    }
    const root = createRoot(host);
    await act(async () => root.render(<Host />));
    await tick();
    const rowEl = document.getElementById('t-row')!;
    rowEl.focus();
    expect(focused()).toBe(label(rowEl));
    // The folder opens: the list is replaced by a loading state and the focused row unmounts.
    await act(async () => hideRow());
    await tick();
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
    // A second ↵ meant for the next folder row must not run "Move here".
    await key(document.body, 'keydown');
    await key(document.body, 'keyup');
    expect(submits.n).toBe(0);
    expect(focused()).toBe(label(document.querySelector('[role=dialog]')));
    await act(async () => root.unmount());
    host.remove();
  });
});
