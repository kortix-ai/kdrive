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

const HUE_RING = [32, 72, 118, 162, 205, 262, 352];

/** A stable object hue for a name, so a person keeps their colour everywhere. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUE_RING[h % HUE_RING.length]!;
}

/**
 * Avatar: a circle in the person's hue (oklch .50 / .11, white initials, 6:1), or their photo. Below 24 px it
 * shows one initial, two from 24 up. `size` 28 (top bar) · 24 (tables) · 32/40 (settings). `ring` adds a 1 px
 * hair ring (for photos on busy grounds).
 */
export function Avatar({ name, image, size = 32, className, ring = true }: { name: string; image?: string | null; size?: number; className?: string; ring?: boolean }) {
  const style: React.CSSProperties = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.42)) };
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
  const initials = initialsOf(name);
  return (
    <span className={cx(frame, 'font-semibold leading-none tracking-[-0.01em] text-white')} style={{ ...style, background: `oklch(0.5 0.11 ${avatarHue(name)})` }} aria-hidden>
      {size < 24 ? initials.slice(0, 1) : initials}
    </span>
  );
}

export default Avatar;
