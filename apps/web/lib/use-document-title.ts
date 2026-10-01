'use client';

import { useLayoutEffect } from 'react';

/**
 * Keeps `document.title` at `title` while mounted. The router re-applies the route's metadata title after
 * client-side URL changes (a deep link's query being tidied away), so the <title> is watched and restored.
 */
export function useDocumentTitle(title: string | null): void {
  // A layout effect: its cleanup runs in the same commit that unmounts the page, before the observer could
  // undo the next route's title.
  useLayoutEffect(() => {
    if (!title) return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const obs = typeof MutationObserver === 'undefined' ? null : new MutationObserver(apply);
    obs?.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => obs?.disconnect();
  }, [title]);
}
