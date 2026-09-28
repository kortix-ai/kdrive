import { afterEach, describe, expect, test } from 'bun:test';
import { registerShellIntents, resetShellIntents, sendShellIntent } from './shell-intents';

afterEach(() => resetShellIntents());

describe('shell intents', () => {
  test('runs at once when the drive is mounted', () => {
    let n = 0;
    const off = registerShellIntents({ search: () => n++ });
    expect(sendShellIntent('search')).toBe(true);
    expect(n).toBe(1);
    off();
    expect(sendShellIntent('search')).toBe(false);
    expect(n).toBe(1);
  });

  test('parks an intent until a drive registers', async () => {
    let made = 0;
    expect(sendShellIntent('new-folder')).toBe(false);
    registerShellIntents({ 'new-folder': () => made++ });
    await new Promise((r) => setTimeout(r, 5));
    expect(made).toBe(1);
  });

  test('an unregister from a stale drive does not drop the new one', () => {
    let n = 0;
    const offOld = registerShellIntents({ search: () => {} });
    registerShellIntents({ search: () => n++ });
    offOld();
    expect(sendShellIntent('search')).toBe(true);
    expect(n).toBe(1);
  });
});
