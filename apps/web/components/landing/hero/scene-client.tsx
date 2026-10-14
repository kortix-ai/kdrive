'use client';

import { useEffect, useRef, useState } from 'react';
import { createField, type FieldHandle } from './engine/field';

// Owns the WebGL layer of the hero (LANDING-SPEC §5): the canvas host, the CSS
// cursor glow, the label layer and the hint row. It mounts the engine, hands
// the poster off after the first frame, and cleans everything up on unmount.
const COPY_SELECTOR = [
  '.kd-hero__copy > .kd-eyebrow',
  '.kd-wordmark',
  '.kd-tagline',
  '.kd-hero__sub',
  '.kd-hero__ctas > *',
  '.kd-hero__agents',
].join(',');

export default function SceneClient() {
  const hostRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const field = useRef<FieldHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const hero = host?.closest<HTMLElement>('.kd-hero');
    if (!host || !hero || !layerRef.current) return;
    const dev = process.env.NODE_ENV !== 'production';
    if (dev && new URLSearchParams(window.location.search).has('nogl')) return;
    const reduced =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      (dev && new URLSearchParams(window.location.search).has('reduced'));
    const copy = hero.querySelector<HTMLElement>('.kd-hero__copy');
    let fade = 0;
    try {
      field.current = createField({
        hero,
        canvasHost: host,
        layer: layerRef.current,
        glow: glowRef.current,
        copyEls: () => Array.from(hero.querySelectorAll(COPY_SELECTOR)),
        reduced,
        dev,
        onReady: () => {
          setReady(true);
          hero.setAttribute('data-kd-gl', 'live');
          // poster → canvas crossfade (240ms), then the poster leaves the DOM
          // (only the SVG markup goes; the wrappers stay React's)
          fade = window.setTimeout(() => {
            hero.querySelectorAll('.kd-hero__poster-art').forEach((el) => el.replaceChildren());
            hero.setAttribute('data-kd-gl', 'done');
          }, 300);
        },
        onFan: (isOpen) => {
          setOpen(isOpen);
          copy?.classList.toggle('kd-hero__copy--fanned', isOpen);
        },
      });
    } catch {
      return; // no WebGL: the poster stays as the illustration, and no hint shows
    }
    return () => {
      window.clearTimeout(fade);
      field.current?.dispose();
      field.current = null;
      copy?.classList.remove('kd-hero__copy--fanned');
      hero.removeAttribute('data-kd-gl');
    };
  }, []);

  return (
    <>
      <div ref={glowRef} className="kd-hero__glow" aria-hidden="true" />
      <div ref={hostRef} className="kd-hero__canvas" aria-hidden="true" />
      <div ref={layerRef} className="kd-hero__labels" aria-hidden="true" />
      <div className={`kd-hero__hint${ready ? ' is-on' : ''}`} hidden={!ready}>
        <span className="kd-hero__hint-fine" aria-hidden="true">
          <kbd>Click</kbd> a drive to see its versions · <kbd>drag</kbd> to throw it
        </span>
        <span className="kd-hero__hint-coarse" aria-hidden="true">
          <kbd>Tap</kbd> a drive to see its versions
        </span>
        <button
          type="button"
          className="kd-hero__hint-btn"
          aria-pressed={open}
          onClick={() => field.current?.toggleFirst()}
        >
          Show a drive&apos;s versions
        </button>
      </div>
    </>
  );
}
