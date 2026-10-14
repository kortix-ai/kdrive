// Sidebar collapse (wide screens): localStorage['vx-side'] = 'collapsed' | 'open', painted onto
// <html data-vx-side>. lib/theme-boot.ts applies the stored value before first paint; under 1024 px
// the width decides (64 px rail, or the phone drawer) and this preference is ignored.
import { useSyncExternalStore } from 'react';

export const SIDE_KEY = 'vx-side';
const EVENT = 'vx-side';

export function isSideCollapsed(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.vxSide === 'collapsed';
}

export function setSideCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? 'collapsed' : 'open');
  } catch {
    /* private mode: lasts for this page only */
  }
  document.documentElement.dataset.vxSide = collapsed ? 'collapsed' : 'open';
  window.dispatchEvent(new Event(EVENT));
}

export const toggleSide = () => setSideCollapsed(!isSideCollapsed());

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Whether the wide-screen sidebar is collapsed to its icon rail. */
export function useSideCollapsed(): boolean {
  return useSyncExternalStore(subscribe, isSideCollapsed, () => false);
}
