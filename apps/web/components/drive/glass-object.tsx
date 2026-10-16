// The glass folder as drawn in the app (folder cards, the new-folder card, ghosts). The landing draws the
// same object; this one is sized by its parent's width and coloured by the folder's hue (objectHue).
import { cx } from '@/components/ui/cx';
import { objectHue } from '@/components/ui/file-icon';
import g from './glass.module.css';

export type GlassPaper = 'doc' | 'photo' | 'grid' | 'code' | 'slide';

/** One ink stroke: up the left edge from the glass, over the tab, along the back's top edge, down the right side. */
const INK = 'M3 27.6 L3 5.4 Q3 0.4 8 0.4 L35.4 0.4 L42.5 9.4 L90.5 9.4 Q97 9.4 97 15.9 L97 27.6';

/** What peeks out of a folder, guessed from its name (decoration only: a folder's contents are not read). */
export function paperFor(name: string): GlassPaper {
  const n = name.toLowerCase();
  if (/photo|image|picture|img|shot|camera|lisbon|trip|travel/.test(n)) return 'photo';
  if (/code|src|dev|engineer|app|script|repo|api/.test(n)) return 'code';
  if (/financ|budget|sheet|data|report|invoice|tax|account/.test(n)) return 'grid';
  if (/deck|slide|present|pitch|launch/.test(n)) return 'slide';
  return 'doc';
}

export function GlassObject({
  name,
  paper,
  tag,
  past,
  ghost,
  className,
  style,
}: {
  /** The folder's name: picks its hue (and its inserts unless `paper` is given). */
  name: string;
  paper?: GlassPaper;
  /** A short Mono pill on the front. */
  tag?: React.ReactNode;
  past?: boolean;
  /** Not there at this version: a dashed outline. */
  ghost?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const h = objectHue(name);
  const box = { ...style, ['--h' as string]: String(h) } as React.CSSProperties;
  if (ghost) {
    return (
      <div aria-hidden className={cx(g.obj, g.ghost, 'pointer-events-none select-none', className)} style={box}>
        <span className={g.gBack} />
        <span className={g.gFront} />
      </div>
    );
  }
  const p = paper ?? paperFor(name);
  return (
    <div aria-hidden className={cx(g.obj, past && g.past, 'pointer-events-none select-none', className)} style={box}>
      <span className={g.back} />
      <span className={cx(g.paper, p !== 'doc' && g[p])} />
      {p === 'doc' || p === 'photo' ? <span className={cx(g.paper, g.p2)} /> : null}
      <span className={g.front}>{tag ? <span className={g.tag}>{tag}</span> : null}</span>
      <svg className={g.line} viewBox="0 0 100 72" preserveAspectRatio="none">
        <path d={INK} />
      </svg>
    </div>
  );
}

export default GlassObject;
