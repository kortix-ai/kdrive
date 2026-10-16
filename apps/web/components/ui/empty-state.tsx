import { cx } from './cx';
import { GlassFolder, HUES, type GlassPaper } from './glass-folder';

/** Which glass object an empty state draws. */
export type EmptyArtKey = 'drive' | 'folder' | 'search' | 'history' | 'checkpoints' | 'deleted' | 'links' | 'proposals' | 'gone' | 'admins';

/** One object per key: a hue and an insert; nothing (search, deleted, gone) draws as a dashed ghost. */
const ART: Record<EmptyArtKey, { hue: number; paper?: GlassPaper; ghost?: boolean }> = {
  drive: { hue: HUES.coral, paper: 'doc' },
  folder: { hue: HUES.mint, paper: 'none' },
  search: { hue: HUES.aqua, ghost: true },
  history: { hue: HUES.cobalt, paper: 'doc' },
  checkpoints: { hue: HUES.amber, paper: 'slide' },
  deleted: { hue: HUES.rose, ghost: true },
  links: { hue: HUES.aqua, paper: 'none' },
  proposals: { hue: HUES.cobalt, paper: 'code' },
  gone: { hue: HUES.cobalt, ghost: true },
  admins: { hue: HUES.lime, paper: 'grid' },
};

/**
 * Empty-state illustration: one glass object, 120 px wide (96 on phones), decorative. `tone="past"` draws the
 * object in cobalt, the past's colour. `float` is accepted for old callers and ignored (the art is static).
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
  const a = ART[key];
  return (
    <div className={cx('flex items-center justify-center', className)} aria-hidden>
      <GlassFolder hue={tone === 'past' ? HUES.cobalt : a.hue} paper={a.paper} ghost={a.ghost} size={size} className="max-[720px]:!w-24" />
    </div>
  );
}

/** Teaching empty state: art, 20 gap, title (17/600), 6 gap, one line (15 text-3, max 360), at most one action. */
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
      {art ? <EmptyArt className="mb-5" art={key} tone={tone} /> : null}
      <div className="vx-title">{title}</div>
      {body ? <p className="vx-body-lg mt-1.5 text-vx-text-3">{body}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default EmptyState;
