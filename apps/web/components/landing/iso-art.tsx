import { Iso, type IsoExtra } from '@/components/art/iso';
import { type IsoBox, type Vec3, voxelBlock } from '@/components/art/iso-geom';

// Isometric voxel art pieces for the feature grid, the duplicate mock and the
// final CTA (LANDING-SPEC §6.5, §6.3d, §6.8), also used by the app's empty
// states. The renderer (`Iso`) is shared and reads the theme's --vx-iso-* tokens.

export { Iso };
type Extra = IsoExtra;

/* ── the art pieces ──────────────────────────────────────────────────── */

const slab = (at: Vec3, size: Vec3, style: IsoBox['style'] = 'solid'): IsoBox => ({ at, size, style });

export const FEATURE_ART = {
  versions: {
    label: 'Three stacked version slabs',
    boxes: [0, 1, 2].map((k) => slab([0, k * 0.62, 0], [3, 0.34, 3], k === 2 ? 'hi' : 'solid')),
  },
  checkpoints: {
    label: 'A slab with a raised checkpoint tab',
    boxes: [slab([0, 0, 0], [4, 0.7, 2.2]), slab([1.5, 0.7, 0.6], [1, 0.42, 1], 'lit')],
  },
  deleted: {
    label: 'A cube with one voxel missing, outlined in dashes',
    boxes: voxelBlock([2, 2, 2], [0, 0, 0], (x, y, z) => (x === 1 && y === 1 && z === 1 ? 'ghost' : 'solid')),
  },
  upload: {
    label: 'A tray holding smaller blocks, one more dropping in',
    // a 3×3 floor (tiles, so the painter sort keeps every block above its tile),
    // three blocks in their cells, one dropping in, and the tray's two near walls
    boxes: [
      ...[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => slab([i * 1.2, 0, j * 1.2], [1.2, 0.24, 1.2], 'dim'))),
      ...([[0, 0], [1, 0], [0, 1]] as const).map(([i, j]) => slab([i * 1.2 + 0.12, 0.24, j * 1.2 + 0.12], [0.96, 0.84, 0.96], 'graphite')),
      slab([1.32, 1.55, 1.32], [0.96, 0.84, 0.96], 'lit'),
      slab([0, 0, 3.6], [3.8, 0.62, 0.2], 'dim'),
      slab([3.6, 0, 0], [0.2, 0.62, 3.6], 'dim'),
    ],
  },
  history: {
    label: 'A column of three cubes, the top one solid',
    boxes: [slab([0, 0, 0], [1.4, 1.4, 1.4], 'ghost'), slab([0, 1.55, 0], [1.4, 1.4, 1.4], 'dim'), slab([0, 3.1, 0], [1.4, 1.4, 1.4], 'hi')],
  },
  keyboard: {
    label: 'A keycap with the letter K',
    boxes: [slab([0, 0, 0], [2.6, 0.9, 2.6], 'lit')],
    extras: [{ kind: 'glyph', at: [1.3, 0.9, 1.3], text: 'K' }] as Extra[],
  },
} as const;

export type FeatureArtKey = keyof typeof FEATURE_ART;

export function FeatureArt({ name, className }: { name: FeatureArtKey; className?: string }) {
  const art = FEATURE_ART[name];
  return <Iso id={`kd-iso-${name}`} boxes={[...art.boxes]} extras={'extras' in art ? [...art.extras] : []} label={art.label} className={className} />;
}

/** The duplicate mock's cube: dashed ghost until the fork is made, then solid. */
export function ForkCube({ solid, className }: { solid: boolean; className?: string }) {
  return <Iso id={`kd-iso-fork-${solid ? 's' : 'g'}`} boxes={[slab([0, 0, 0], [1, 1, 1], solid ? 'hi' : 'ghost')]} className={className} />;
}
