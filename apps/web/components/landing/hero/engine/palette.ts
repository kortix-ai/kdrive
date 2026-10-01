// The hero scene's per-theme palettes (UNIFY-SPEC §13.4). The only colour literals in the engine live here:
// SCENE_DARK is the original studio (graphite cubes in a dark room), SCENE_LIGHT the same machined cubes lit
// by a bright studio on a pale ground, with lighter fog that fades distant cubes toward the ground.
// Engine modules read the active palette through `palette()`; Field.setTheme() swaps it live.

export interface ScenePalette {
  name: 'dark' | 'light';
  /** fog and ground colour (= --vx-bg) */
  ground: number;
  /** fog near/far offsets from the camera distance */
  fogNear: number;
  fogFar: number;
  exposure: number;
  env: {
    domeTop: number; domeMid: number; domeLow: number;
    softbox: [number, number];
    fillL: [number, number]; fillR: [number, number];
    stripL: [number, number]; stripR: [number, number];
    floor: [number, number];
  };
  hemi: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number };
  fill: { color: number; intensity: number };
  metal: { color: number; metalness: number; roughness: number; envIntensity: number };
  /** the dark core behind the grout */
  core: number;
  shade: { color: number; opacity: number };
  /** ghost and stack dashed shells */
  dashed: number;
  dashedK: number;
  /** hover rim and trail chevrons */
  rim: number;
  rimK: number;
  /** a solid's panel lines */
  panel: number;
  seam: { color: number; scale: number; glow: number | null };
  slice: { edge: number; head: number; base: string; tone: number; grout: string | null };
  cursor: { color: number; tint: number; mix: number; idle: number; active: number };
  specks: { color: number; opacity: number };
  /** the SSR poster: face tones are fitted per theme (top / side / down), fog lerps to `ground` */
  poster: { lo: number; mid: number; hi: number; tint: number; edge: string; edgeK: number; seam: string; trail: string; dash: string; core: string; plate: string; panel: string; shade: string; shadeK: number };
}

export const SCENE_DARK: ScenePalette = {
  name: 'dark',
  ground: 0x0a0a0b,
  fogNear: -2,
  fogFar: 18,
  exposure: 1,
  env: {
    domeTop: 0x60656f, domeMid: 0x2b2d34, domeLow: 0x3e3f48,
    softbox: [0xe8eaee, 2.4],
    fillL: [0x9ea1a8, 0.85], fillR: [0x6f7279, 0.62],
    stripL: [0xeef3fb, 3.4], stripR: [0xd3dbe8, 1.6],
    floor: [0x3f3c4c, 1.0],
  },
  hemi: { sky: 0xcfd6e4, ground: 0x16161a, intensity: 0.35 },
  key: { color: 0xe8eaee, intensity: 0.75 },
  fill: { color: 0xc8ccd4, intensity: 0.28 },
  metal: { color: 0xb8bbc1, metalness: 0.82, roughness: 0.6, envIntensity: 1.15 },
  core: 0x09090b,
  shade: { color: 0x000000, opacity: 1 },
  dashed: 0x9aa0ab,
  dashedK: 1,
  rim: 0xe3e6ec,
  rimK: 1,
  panel: 0x16171c,
  seam: { color: 0xeef1f7, scale: 0.85, glow: 0xcfd6e6 },
  slice: { edge: 0xcfd3db, head: 0xf6f7f9, base: '#0c0c0e', tone: 150, grout: null },
  cursor: { color: 0xdfe3ea, tint: 0xa78bfa, mix: 0.1, idle: 14, active: 18 },
  specks: { color: 0x8b82c9, opacity: 0.35 },
  poster: {
    lo: 33, mid: 13, hi: 79, tint: 11,
    edge: 'rgb(214,219,228)', edgeK: 0.32, seam: '#70747d', trail: '#e3e6ec', dash: '#9aa0ab', core: '#09090b', plate: '#0b0b0d', panel: '#16171c',
    shade: '#000', shadeK: 1,
  },
};

export const SCENE_LIGHT: ScenePalette = {
  name: 'light',
  ground: 0xf4f4f6,
  fogNear: -1,
  fogFar: 15,
  exposure: 1.12,
  env: {
    domeTop: 0xffffff, domeMid: 0xaeb2ba, domeLow: 0x7c808a,
    softbox: [0xffffff, 2.7],
    fillL: [0xd7d9de, 0.9], fillR: [0x5f636c, 0.36],
    stripL: [0xffffff, 2.6], stripR: [0xe9edf3, 1.2],
    floor: [0x9b96ad, 0.7],
  },
  hemi: { sky: 0xffffff, ground: 0x9ea3ad, intensity: 0.55 },
  key: { color: 0xffffff, intensity: 1.0 },
  fill: { color: 0xdfe3ea, intensity: 0.06 },
  metal: { color: 0xd4d7dc, metalness: 0.7, roughness: 0.55, envIntensity: 1.0 },
  core: 0x3a3d45,
  shade: { color: 0x1a1b22, opacity: 0.22 / 0.32 },
  dashed: 0x5b606b,
  dashedK: 0.95,
  rim: 0x2a2c32,
  rimK: 0.86,
  panel: 0x8d929b,
  seam: { color: 0x2a2c32, scale: 1, glow: null },
  slice: { edge: 0x4a4e57, head: 0x111114, base: '#9ea3ac', tone: 215, grout: '#9ea3ac' },
  cursor: { color: 0xffffff, tint: 0x6a4bd6, mix: 0.06, idle: 10, active: 16 },
  specks: { color: 0x8f88b8, opacity: 0.22 },
  poster: {
    lo: 140, mid: 32, hi: 50, tint: 6,
    edge: 'rgb(255,255,255)', edgeK: 0.7, seam: '#2a2c32', trail: '#2a2c32', dash: '#5b606b', core: '#3a3d45', plate: '#9ea3ac', panel: '#8d929b',
    shade: '#1a1b22', shadeK: 0.69,
  },
};

let active: ScenePalette = SCENE_DARK;

/** The palette the engine draws with right now. */
export function palette(): ScenePalette {
  return active;
}

export function setPalette(p: ScenePalette): void {
  active = p;
}

/** The palette matching what the page paints (html[data-vx-theme]). */
export function documentPalette(): ScenePalette {
  return typeof document !== 'undefined' && document.documentElement.dataset.vxTheme === 'light' ? SCENE_LIGHT : SCENE_DARK;
}
