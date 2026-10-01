'use client';

import { useEffect } from 'react';

// Section reveal (LANDING-SPEC §1): elements marked .kd-reveal fade and rise
// once, at 15% intersection, staggered 60ms within each batch. Elements marked
// [data-kd-inview] get .is-in on the same trigger (the How-it-works line draw).
// The CSS applies only under html[data-kd-js] and without reduced motion, so
// SSR HTML is fully visible without JS; here we only add classes.
export function useReveal() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>('.kd .kd-reveal, .kd [data-kd-inview]');
    if (!targets.length) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      for (const el of targets) el.classList.add('is-in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        let n = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          if (el.classList.contains('kd-reveal')) {
            el.style.transitionDelay = `${n * 60}ms`;
            n += 1;
            // Clear the delay afterwards so hover transitions stay instant.
            window.setTimeout(() => {
              el.style.transitionDelay = '';
            }, 600 + n * 60);
          }
          el.classList.add('is-in');
          io.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    for (const el of targets) io.observe(el);
    return () => io.disconnect();
  }, []);
}
