'use client';

// A tiny bridge from the app shell (sidebar "+ New", top-bar search pill) to the
// drive, which owns the search palette and inline folder creation. The drive
// registers handlers while it is mounted; an intent sent while no drive is
// mounted waits here and runs as soon as one registers (the shell navigates to
// /drive first). Uploads do not need the drive: the shell starts them itself.
import { useEffect, useRef } from 'react';

export type ShellIntent = 'search' | 'new-folder';
export type ShellIntentHandlers = Partial<Record<ShellIntent, () => void>>;

let current: ShellIntentHandlers | null = null;
let pending: ShellIntent | null = null;

/** Runs the intent now when a drive is mounted; otherwise parks it and returns false. */
export function sendShellIntent(intent: ShellIntent): boolean {
  const h = current?.[intent];
  if (h) {
    h();
    return true;
  }
  pending = intent;
  return false;
}

/** For tests and hot reload. */
export function resetShellIntents(): void {
  current = null;
  pending = null;
}

export function registerShellIntents(handlers: ShellIntentHandlers): () => void {
  current = handlers;
  if (pending && handlers[pending]) {
    const p = pending;
    pending = null;
    // Let the page finish mounting before opening overlays.
    setTimeout(() => handlers[p]?.(), 0);
  }
  return () => {
    if (current === handlers) current = null;
  };
}

/** Drive side: `useShellIntents({ search: openPalette, 'new-folder': newFolder })`. */
export function useShellIntents(handlers: ShellIntentHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const stable: ShellIntentHandlers = {
      search: () => ref.current.search?.(),
      'new-folder': () => ref.current['new-folder']?.(),
    };
    return registerShellIntents(stable);
  }, []);
}
