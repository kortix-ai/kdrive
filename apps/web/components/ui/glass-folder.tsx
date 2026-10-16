import { cx } from './cx';

/** The seven object hues (oklch hue angles, mirrored by --hue-* in globals.css). No violet. */
export const HUES = { coral: 32, amber: 72, lime: 118, mint: 162, aqua: 205, cobalt: 262, rose: 352 } as const;
export type HueName = keyof typeof HUES;

export type GlassPaper = 'doc' | 'photo' | 'grid' | 'slide' | 'code' | 'none';

/**
 * One ink stroke over the back and its tab: up the left edge from the glass, over the tab, along the back's top
 * edge and down the right side. viewBox 100 × 72, stretched to the object.
 */
const INK = 'M3 27.6 L3 5.4 Q3 0.4 8 0.4 L35.4 0.4 L42.5 9.4 L90.5 9.4 Q97 9.4 97 15.9 L97 27.6';

const LINE = 'var(--vx-paper-line)';

function paperStyle(kind: GlassPaper, second: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: second ? '42%' : '13%',
    width: '44%',
    top: second ? '8%' : '5%',
    height: '64%',
    borderRadius: '3cqw',
    background: 'var(--vx-paper)',
    transform: `rotate(${second ? 7 : -6}deg)`,
    transformOrigin: '50% 100%',
    boxShadow: '0 1px 2px rgba(0,0,0,.12), 0 6px 14px -6px rgba(0,0,0,.22)',
  };
  if (kind === 'photo' && !second) {
    return { ...base, background: 'radial-gradient(circle at 70% 26%, oklch(0.88 0.12 85) 0 11%, transparent 12%), linear-gradient(180deg, oklch(0.84 0.07 230) 0 55%, oklch(0.72 0.10 150) 55%)' };
  }
  if (kind === 'grid') {
    return {
      ...base,
      backgroundImage: `linear-gradient(oklch(0.70 0.12 162 / .55), oklch(0.70 0.12 162 / .55)), repeating-linear-gradient(90deg, transparent 0 9cqw, ${LINE} 9cqw calc(9cqw + 1px)), repeating-linear-gradient(180deg, transparent 0 5cqw, ${LINE} 5cqw calc(5cqw + 1px))`,
      backgroundSize: '100% 5cqw, 100% 100%, 100% 100%',
      backgroundRepeat: 'no-repeat',
    };
  }
  if (kind === 'slide') {
    return {
      ...base,
      background: 'oklch(0.94 0.03 72)',
      backgroundImage: `linear-gradient(oklch(0.74 0.13 72), oklch(0.74 0.13 72)), linear-gradient(${LINE}, ${LINE})`,
      backgroundSize: '60% 22%, 40% 1.6cqw',
      backgroundPosition: '50% 30%, 50% 70%',
      backgroundRepeat: 'no-repeat',
    };
  }
  if (kind === 'code') {
    return {
      ...base,
      backgroundImage: `linear-gradient(oklch(0.62 0.12 205), oklch(0.62 0.12 205)), linear-gradient(oklch(0.70 0.13 72), oklch(0.70 0.13 72)), linear-gradient(oklch(0.62 0.13 352), oklch(0.62 0.13 352)), linear-gradient(${LINE}, ${LINE})`,
      backgroundSize: '40% 1.6cqw, 28% 1.6cqw, 46% 1.6cqw, 30% 1.6cqw',
      backgroundPosition: '14% 14%, 26% 28%, 26% 42%, 14% 56%',
      backgroundRepeat: 'no-repeat',
    };
  }
  // A ruled document: two heading bars, then lines.
  return {
    ...base,
    filter: second ? 'brightness(.985)' : undefined,
    backgroundImage: `linear-gradient(${LINE}, ${LINE}), linear-gradient(${LINE}, ${LINE}), repeating-linear-gradient(180deg, transparent 0 5.5cqw, ${LINE} 5.5cqw calc(5.5cqw + 1px))`,
    backgroundSize: '50% 1.6cqw, 34% 1.2cqw, 76% 64%',
    backgroundPosition: '12% 12%, 12% 22%, 50% 88%',
    backgroundRepeat: 'no-repeat',
  };
}

/**
 * The glass object: one component at 1 : 0.72, coloured only by `hue`. A tinted back and tab (its fill nudged
 * 2px off the single ink stroke), paper inserts, and a frosted front the inserts blur through. Sizes: 180 on the
 * landing, 150 in the app, smaller as decoration. `ghost` draws the dashed outline of an object that does not exist
 * (yet, or any more). Decorative: the caller names what it stands for.
 */
export function GlassFolder({
  hue = HUES.cobalt,
  size = 150,
  paper = 'doc',
  tag,
  glyph,
  ghost,
  tilt,
  className,
  style,
}: {
  hue?: number;
  size?: number;
  paper?: GlassPaper;
  /** A short mono pill on the front (a version, a count, a name). */
  tag?: React.ReactNode;
  /** A 16-24 px line icon in the front's top-right corner. */
  glyph?: React.ReactNode;
  ghost?: boolean;
  /** Rotation in degrees (decorative scatter, at most ±3). */
  tilt?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const h = String(hue);
  const box: React.CSSProperties = {
    width: size,
    aspectRatio: '1 / 0.72',
    position: 'relative',
    containerType: 'inline-size',
    flex: 'none',
    transform: tilt ? `rotate(${tilt}deg)` : undefined,
    ...style,
  };
  if (ghost) {
    const dash = '1.5px dashed var(--vx-hair-dash)';
    return (
      <div aria-hidden className={cx('pointer-events-none select-none', className)} style={box}>
        <span style={{ position: 'absolute', left: '3%', right: '3%', top: '13%', bottom: '7%', borderRadius: '0 6.5cqw 6cqw 6cqw', border: dash }}>
          <span style={{ position: 'absolute', left: -1.5, bottom: '100%', width: '42%', height: '9cqw', borderRadius: '5cqw 5cqw 0 0', border: dash, borderBottom: 0 }} />
        </span>
        <span
          style={{
            position: 'absolute',
            inset: '38% 0 0 0',
            borderRadius: '5cqw 5cqw 7cqw 7cqw',
            border: dash,
            background: 'color-mix(in oklab, var(--vx-surface) 55%, transparent)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: '0 5.5cqw 5cqw',
          }}
        >
          {tag ? <GlassTag hue={h} muted>{tag}</GlassTag> : null}
        </span>
      </div>
    );
  }
  return (
    <div aria-hidden className={cx('pointer-events-none select-none', className)} style={box}>
      <span
        style={{
          position: 'absolute',
          left: '3%',
          right: '3%',
          top: '13%',
          bottom: '7%',
          borderRadius: '0 6.5cqw 6cqw 6cqw',
          transform: 'translate(2px, 2px)',
          background: `linear-gradient(180deg, oklch(var(--vx-glass-back-l) 0.10 ${h}) 0%, oklch(calc(var(--vx-glass-back-l) - 0.08) 0.105 ${h}) 100%)`,
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            width: '42%',
            height: '9cqw',
            borderRadius: '5cqw 5cqw 0 0',
            background: `oklch(var(--vx-glass-back-l) 0.10 ${h})`,
            clipPath: 'polygon(0 0, 82% 0, 100% 100%, 0 100%)',
          }}
        />
      </span>
      {paper !== 'none' ? <span style={paperStyle(paper, false)} /> : null}
      {paper === 'doc' || paper === 'photo' ? <span style={paperStyle('doc', true)} /> : null}
      <span
        style={{
          position: 'absolute',
          inset: '38% 0 0 0',
          borderRadius: '5cqw 5cqw 7cqw 7cqw',
          background: [
            'radial-gradient(120% 70% at 18% 0%, rgba(255,255,255,.5), transparent 55%)',
            `linear-gradient(172deg, oklch(calc(var(--vx-glass-l) + 0.08) calc(var(--vx-glass-c) * .6) ${h} / calc(var(--vx-glass-a) - .06)) 0%, oklch(var(--vx-glass-l) var(--vx-glass-c) ${h} / var(--vx-glass-a)) 45%, oklch(calc(var(--vx-glass-l) - 0.14) calc(var(--vx-glass-c) + .03) ${h} / calc(var(--vx-glass-a) + .16)) 100%)`,
          ].join(', '),
          backdropFilter: 'blur(7px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(7px) saturate(1.5)',
          border: '1px solid var(--vx-glass-rim)',
          boxShadow: `inset 0 1.5px 0 var(--vx-glass-hi), inset 0 -1.2cqw 3cqw oklch(0.45 0.12 ${h} / .2), 0 3cqw 7cqw -3cqw oklch(0.35 0.10 ${h} / var(--vx-glass-shadow-l))`,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: '0 5.5cqw 5cqw',
        }}
      >
        {glyph ? (
          <span
            style={{
              position: 'absolute',
              right: '6cqw',
              top: '6cqw',
              width: '12cqw',
              height: '12cqw',
              color: 'rgba(255,255,255,.95)',
              filter: `drop-shadow(0 1px 1px oklch(0.4 0.1 ${h} / .35))`,
            }}
            className="[&>svg]:h-full [&>svg]:w-full"
          >
            {glyph}
          </span>
        ) : null}
        {tag ? <GlassTag hue={h}>{tag}</GlassTag> : null}
      </span>
      <svg viewBox="0 0 100 72" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <path
          d={INK}
          fill="none"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: 'var(--vx-ink-line)' }}
        />
      </svg>
    </div>
  );
}

function GlassTag({ hue, muted, children }: { hue: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--vx-font-mono)',
        fontSize: 'max(11px, 6cqw)',
        lineHeight: 1,
        padding: '2.6cqw 3.6cqw',
        borderRadius: 99,
        whiteSpace: 'nowrap',
        color: muted ? 'var(--vx-text-3)' : `oklch(0.25 0.06 ${hue})`,
        background: muted ? 'var(--vx-surface)' : 'rgba(255,255,255,.62)',
        border: muted ? '1px solid var(--vx-hair)' : undefined,
      }}
    >
      {children}
    </span>
  );
}

export default GlassFolder;
