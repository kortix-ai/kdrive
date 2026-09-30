'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// STUB (owned by the HERO builder): owns the canvas and calls the engine
// (hero/engine/*). For now it proves three loads client-side: one clear frame.
export default function SceneClient() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL: the SSR poster stays
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight, false);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    return () => {
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="kd-hero__canvas" aria-hidden="true" />;
}
