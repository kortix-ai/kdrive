'use client';

// "Wrap lines" for code previews: one per-viewer switch shared by the preview panel's head
// (the WrapText icon button) and the code body. Remembered in localStorage when it can be.
import { useSyncExternalStore } from 'react';

const KEY = 'vx-code-wrap';
const listeners = new Set<() => void>();
let wrap: boolean | null = null;

function read(): boolean {
  if (wrap === null) {
    try {
      wrap = localStorage.getItem(KEY) === '1';
    } catch {
      wrap = false;
    }
  }
  return wrap;
}

export function setCodeWrap(next: boolean): void {
  wrap = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* private mode: the switch still works for this tab */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCodeWrap(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
