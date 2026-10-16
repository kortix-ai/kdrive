import { useId } from 'react';
import { Archive, AudioLines, Code2, FileText, Folder, Image as ImageIcon, Presentation, Sheet, Video, type LucideIcon } from 'lucide-react';
import './glass-folder.css';

// The glass folder: the one object of the KDRIVE language. One recipe and one size ratio (1 : 0.72); only the
// hue changes. Back and tab (fill nudged 2px down-right) → paper inserts → frosted front → one ink stroke over the
// back and tab. Sized by `size` (or --vx-obj-w), coloured by a single --h oklch hue angle; the theme's
// --vx-glass-* knobs set lightness, chroma and alpha. Server-safe (no state), so the app can reuse it as is.

/** The seven object hues (oklch hue angles), mirrored as --hue-* in globals.css. No violet. */
export const HUES = { coral: 32, amber: 72, lime: 118, mint: 162, aqua: 205, cobalt: 262, rose: 352 } as const;
export type HueName = keyof typeof HUES;

/** What peeks out of the folder. `two` = two plain sheets; `none` = an empty sleeve (archives). */
export type GlassPaper = 'doc' | 'two' | 'slide' | 'grid' | 'photo' | 'code' | 'wave' | 'film' | 'none';
export type GlassGlyph = 'doc' | 'pdf' | 'slides' | 'sheet' | 'image' | 'video' | 'audio' | 'code' | 'archive' | 'folder';

const GLYPHS: Record<GlassGlyph, LucideIcon> = {
  doc: FileText,
  pdf: FileText,
  slides: Presentation,
  sheet: Sheet,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  code: Code2,
  archive: Archive,
  folder: Folder,
};

// One stroke: the left edge (from the glass up), the tab, the back's top edge, the right edge (down to the glass).
// viewBox is 100 × 72, the object's own aspect.
const INK = 'M3 27.6 L3 5.4 Q3 0.4 8 0.4 L35.4 0.4 L42.5 9.4 L90.5 9.4 Q97 9.4 97 15.9 L97 27.6';

export function GlassFolder({
  hue = 'cobalt',
  paper = 'doc',
  glyph,
  tag,
  faces,
  size,
  zip = false,
  lift = true,
  className,
  style,
}: {
  /** A named hue or a raw oklch hue angle. */
  hue?: HueName | number;
  paper?: GlassPaper;
  glyph?: GlassGlyph;
  /** The mono pill at the front's bottom right (a version, a count, a name). */
  tag?: React.ReactNode;
  /** Up to three initials as avatars at the bottom left. */
  faces?: string[];
  /** Width in px; defaults to --vx-obj-w (180px). */
  size?: number;
  /** Archive look: no papers, a zipper down the front. */
  zip?: boolean;
  /** Papers rise a little on hover. */
  lift?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const wobble = `vxgf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const h = typeof hue === 'number' ? String(hue) : `var(--hue-${hue}, ${HUES[hue]})`;
  const Glyph = glyph ? GLYPHS[glyph] : null;
  const papers =
    paper === 'none' || zip ? null : paper === 'two' ? (
      <>
        <i className="vx-folder__paper" />
        <i className="vx-folder__paper is-p2" />
      </>
    ) : (
      <>
        <i className={`vx-folder__paper is-${paper}`} />
        {(paper === 'doc' || paper === 'photo') && <i className="vx-folder__paper is-p2" />}
      </>
    );
  return (
    <div
      className={`vx-folder${zip ? ' is-zip' : ''}${lift ? ' is-lift' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--h': h, ...(size ? { '--gw': `${size}px` } : null), ...style } as React.CSSProperties}
      aria-hidden="true"
    >
      <i className="vx-folder__back" />
      {papers}
      <div className="vx-folder__front">
        {Glyph && (
          <span className="vx-folder__glyph">
            <Glyph strokeWidth={1.7} />
          </span>
        )}
        {faces?.length ? (
          <span className="vx-folder__faces">
            {faces.slice(0, 3).map((f, i) => (
              <span key={`${f}${i}`} className="vx-folder__face" style={{ '--h': [32, 162, 262][i % 3] } as React.CSSProperties}>
                {f}
              </span>
            ))}
          </span>
        ) : (
          <span />
        )}
        {tag != null && <span className="vx-folder__tag">{tag}</span>}
      </div>
      <svg className="vx-folder__ink" viewBox="0 0 100 72" preserveAspectRatio="none" focusable="false">
        <filter id={wobble} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} seed={7} />
          <feDisplacementMap in="SourceGraphic" scale={1.6} />
        </filter>
        <path d={INK} filter={`url(#${wobble})`} />
      </svg>
    </div>
  );
}

export default GlassFolder;
