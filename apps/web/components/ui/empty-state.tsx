import { cx } from './cx';

/** Static voxel art: three grayscale slabs, one purple block, a dashed ghost slab (the version you can go back to). */
export function VoxelArt({ className, float = true }: { className?: string; float?: boolean }) {
  const slab = (y: number, key: string, accent = false) => (
    <g key={key} transform={`translate(0 ${y})`}>
      <path d="M60 20 L100 40 L60 60 L20 40 Z" fill={accent ? 'var(--ea-p-face)' : 'var(--ea-top)'} stroke="var(--ea-line)" strokeWidth="1" />
      <path d="M20 40 L60 60 L60 72 L20 52 Z" fill="var(--ea-left)" stroke="var(--ea-line)" strokeWidth="1" />
      <path d="M60 60 L100 40 L100 52 L60 72 Z" fill="var(--ea-mid)" stroke="var(--ea-line)" strokeWidth="1" />
    </g>
  );
  return (
    <div className={cx('ea flex flex-col items-center', className)}>
      <div className={float ? 'ea-float' : 'flex'}>
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
          <g transform="translate(0 -6)">
            <path d="M60 8 L100 28 L60 48 L20 28 Z" fill="none" stroke="var(--ea-line)" strokeDasharray="3 3" strokeWidth="1" />
          </g>
          {slab(24, 'a')}
          {slab(12, 'b')}
          {slab(0, 'c', true)}
          <rect x="57" y="36" width="6" height="6" fill="var(--ea-accent)" transform="rotate(45 60 39)" />
        </svg>
      </div>
      <div className={float ? 'ea-shadow' : ''} style={{ width: 64, height: 6, background: 'radial-gradient(closest-side, var(--ea-shadow), transparent)', opacity: 0.3 }} />
    </div>
  );
}

/** Teaching empty state: art, title, one line, optional actions. */
export function EmptyState({
  title,
  body,
  actions,
  art = true,
  className,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  art?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {art ? <VoxelArt className="mb-6" /> : null}
      <div className="vx-title">{title}</div>
      {body ? <p className="vx-body mt-2 max-w-[420px] text-vx-text-3">{body}</p> : null}
      {actions ? <div className="mt-5 flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default EmptyState;
