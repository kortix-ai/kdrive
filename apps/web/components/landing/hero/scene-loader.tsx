'use client';

import dynamic from 'next/dynamic';

// three.js is only ever loaded in the browser, after hydration.
const SceneClient = dynamic(() => import('./scene-client'), { ssr: false });

export function HeroSceneLoader() {
  return <SceneClient />;
}
