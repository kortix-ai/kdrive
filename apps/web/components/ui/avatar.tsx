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
 * Avatar (DESIGN-v2 §5): a circle in --vx-avatar-*, initials 13/600, with a 2 px page-colour gap
 * and a 1 px hair ring. `size` 28 (phone) · 32 (top bar, tables) · 48 (settings profile).
 */
export function Avatar({ name, image, size = 32, className, ring = true }: { name: string; image?: string | null; size?: number; className?: string; ring?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  const frame = cx(
    'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
    ring && 'shadow-[0_0_0_2px_var(--vx-bg),0_0_0_3px_var(--vx-hair)]',
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
