'use client';

import { useEffect, useRef } from 'react';

/**
 * Marks a horizontally scrolling box with `data-more-right="true"` while content is hidden past its right
 * edge, so `.vx-fade-x` can fade that edge (overlay scrollbars give no other hint that more is there).
 */
export function useOverflowFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      if (more) el.dataset.moreRight = 'true';
      else delete el.dataset.moreRight;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  });
  return ref;
}
