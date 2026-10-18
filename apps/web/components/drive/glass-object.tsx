// The glass folder as drawn in the app (folder cards, the new-folder card, ghosts). The landing draws the
// same object; this one is sized by its parent's width, in neutral frosted glass with two plain sheets inside.
import { cx } from '@/components/ui/cx';
import g from './glass.module.css';

/** One ink stroke: up the left edge from the glass, over the tab, along the back's top edge, down the right side. */
const INK = 'M3 27.6 L3 5.4 Q3 0.4 8 0.4 L35.4 0.4 L42.5 9.4 L90.5 9.4 Q97 9.4 97 15.9 L97 27.6';

export function GlassObject({
  tag,
  past,
  ghost,
  className,
  style,
}: {
  /** The folder's name (kept for callers; the object no longer varies by name). */
  name: string;
  /** A short Mono pill on the front. */
  tag?: React.ReactNode;
  past?: boolean;
  /** Not there at this version: a dashed outline. */
  ghost?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (ghost) {
    return (
      <div aria-hidden className={cx(g.obj, g.ghost, 'pointer-events-none select-none', className)} style={style}>
        <span className={g.gBack} />
        <span className={g.gFront} />
      </div>
    );
  }
  return (
    <div aria-hidden className={cx(g.obj, past && g.past, 'pointer-events-none select-none', className)} style={style}>
      <span className={g.back} />
      <span className={g.paper} />
      <span className={cx(g.paper, g.p2)} />
      <span className={g.front}>{tag ? <span className={g.tag}>{tag}</span> : null}</span>
      <svg className={g.line} viewBox="0 0 100 72" preserveAspectRatio="none">
        <path d={INK} />
      </svg>
    </div>
  );
}

export default GlassObject;
