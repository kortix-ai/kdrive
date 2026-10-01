import { cx } from './cx';

export function initialsOf(name: string): string {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '·'
  );
}

/**
 * Avatar (UNIFY-SPEC §10): a neutral circle in --vx-avatar-*, initials 600, with a 1 px hair ring.
 * `size` 28 (top bar) · 24 (tables) · 32/40 (settings).
 */
export function Avatar({ name, image, size = 32, className, ring = true }: { name: string; image?: string | null; size?: number; className?: string; ring?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) };
  const frame = cx(
    'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
    ring && 'shadow-[0_0_0_1px_var(--vx-hair-strong)]',
    className,
  );
  if (image) {
    return (
      <span className={frame} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" width={size} height={size} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      </span>
    );
  }
  return (
    <span className={cx(frame, 'bg-vx-avatar-bg font-semibold leading-none text-vx-avatar-fg')} style={style} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

export default Avatar;
