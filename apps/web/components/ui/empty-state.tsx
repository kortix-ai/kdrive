import { Iso } from '@/components/art/iso';
import type { IsoBox, Vec3 } from '@/components/art/iso-geom';
import { FEATURE_ART } from '@/components/landing/iso-art';
import { cx } from './cx';

/** Which voxel composition an empty state draws (UNIFY-SPEC §9). */
export type EmptyArtKey = 'drive' | 'folder' | 'search' | 'history' | 'checkpoints' | 'deleted' | 'links' | 'proposals' | 'gone' | 'admins';

const slab = (at: Vec3, size: Vec3, style: IsoBox['style'] = 'solid'): IsoBox => ({ at, size, style });

type Piece = { boxes: IsoBox[]; extras?: Parameters<typeof Iso>[0]['extras'] };

function piece(art: EmptyArtKey, past: boolean): Piece {
  switch (art) {
    case 'drive':
      return { boxes: [...FEATURE_ART.upload.boxes] };
    case 'folder':
      return { boxes: [slab([0, 0, 0], [3.4, 0.5, 3.4], 'dim'), slab([1.1, 0.5, 1.1], [1.2, 1.2, 1.2], 'ghost')] };
    case 'search':
    case 'deleted':
      return { boxes: [...FEATURE_ART.deleted.boxes] };
    case 'history':
      return { boxes: [...FEATURE_ART.history.boxes] };
    case 'checkpoints':
      return { boxes: [...FEATURE_ART.checkpoints.boxes] };
    case 'links':
      return { boxes: [slab([0, 0, 0], [1.6, 1.6, 1.6], 'ghost')] };
    case 'proposals':
      return { boxes: [...FEATURE_ART.versions.boxes] };
    case 'admins':
      return { boxes: [...FEATURE_ART.keyboard.boxes], extras: [...FEATURE_ART.keyboard.extras] };
    case 'gone':
    default:
      // a ghost cube with one seam drawn down its near edge (in the past colour when it is the past)
      return {
        boxes: [slab([0, 0, 0], [1.8, 1.8, 1.8], 'ghost')],
        extras: [{ kind: 'seam', a: [1.8, 0, 1.8], b: [1.8, 1.8, 1.8], tone: past ? 'past' : 'default' }],
      };
  }
}

/**
 * Empty-state illustration (UNIFY-SPEC §9): static isometric voxels, 120 px wide (96 on phones), decorative.
 * `tone="past"` only turns the seam accent to the past colour; there are no amber fills.
 * `float` is accepted for old callers and ignored (the art is static, like the landing's).
 */
export function EmptyArt({
  art,
  tone = 'default',
  size = 120,
  className,
}: {
  art?: EmptyArtKey;
  tone?: 'default' | 'past';
  size?: number;
  className?: string;
  float?: boolean;
}) {
  const key: EmptyArtKey = art ?? (tone === 'past' ? 'gone' : 'drive');
  const p = piece(key, tone === 'past');
  return (
    <div className={cx('flex items-center justify-center', className)} aria-hidden>
      <Iso
        id={`vx-ea-${key}-${tone}`}
        boxes={p.boxes}
        extras={p.extras}
        className="h-auto max-h-[96px] max-w-full max-[720px]:max-h-[80px]"
        width={size}
      />
    </div>
  );
}

/** Teaching empty state: art, 20 gap, title (16/600), 6 gap, one line (15 text-3, max 360), at most one action. */
export function EmptyState({
  title,
  body,
  actions,
  art = true,
  tone = 'default',
  className,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  /** true draws the default art for the tone; a key picks a composition; false draws none. */
  art?: boolean | EmptyArtKey;
  tone?: 'default' | 'past';
  className?: string;
}) {
  const key = typeof art === 'string' ? art : undefined;
  return (
    <div className={cx('mx-auto flex max-w-[360px] flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {art ? <EmptyArt className="mb-5 max-[720px]:[&_svg]:w-24" art={key} tone={tone} /> : null}
      <div className="vx-title">{title}</div>
      {body ? <p className="vx-body-lg mt-1.5 text-vx-text-3">{body}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default EmptyState;
