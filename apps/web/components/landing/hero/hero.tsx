import Link from 'next/link';
import { Bot } from 'lucide-react';
import { KMark } from '@/components/brand/k-mark';
import { AsciiField } from '../ascii-field';
import { DRIVE_HREF, SIGNUP_HREF } from '../cta';
import { GlassFolder, type GlassGlyph, type GlassPaper, type HueName } from '../glass-folder';
import { HeroStrip } from './hero-strip';

// The hero: the sketch, drawn. Three glass folders above the wordmark and three below, all one size and one
// recipe, only the hue changes; dot trails run between them. The paper is a 24px dot grid with a live ASCII
// grain at the edges, and the app's time strip previews at the foot. Server component; only the ASCII canvas
// is a client island. Phones keep two folders per row.

type Obj = { hue: HueName; paper: GlassPaper; glyph: GlassGlyph; tag: string; zip?: boolean; r: number; y: number };

const TOP: Obj[] = [
  { hue: 'coral', paper: 'doc', glyph: 'pdf', tag: 'v12', r: -3, y: 6 },
  { hue: 'cobalt', paper: 'slide', glyph: 'slides', tag: 'Deck', r: 2, y: -4 },
  { hue: 'mint', paper: 'grid', glyph: 'sheet', tag: 'Q4.csv', r: -2, y: 10 },
];
const BOTTOM: Obj[] = [
  { hue: 'amber', paper: 'none', glyph: 'archive', tag: 'ZIP · 1.2 GB', zip: true, r: 2, y: -6 },
  { hue: 'aqua', paper: 'code', glyph: 'code', tag: 'src', r: -2, y: 8 },
  { hue: 'rose', paper: 'photo', glyph: 'image', tag: '22 photos', r: 3, y: -2 },
];

function Trail({ n }: { n: number }) {
  return (
    <span className="kd-trail" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

function Row({ set, at }: { set: Obj[]; at: 'top' | 'bot' }) {
  return (
    <div className={`kd-hrow kd-hrow--${at}`} aria-hidden="true">
      {set.map((o, i) => (
        <span key={o.hue} className="kd-hrow__cell">
          {i > 0 && <Trail n={5} />}
          <span className="kd-hrow__obj" style={{ '--r': `${o.r}deg`, '--y': `${o.y}px`, '--kd-i': i + (at === 'bot' ? 3 : 0) } as React.CSSProperties}>
            <span className="kd-float">
              <GlassFolder hue={o.hue} paper={o.paper} glyph={o.glyph} tag={o.tag} zip={o.zip} />
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="top" className="kd-hero" aria-labelledby="kd-hero-title">
      <div className="kd-hero__field" aria-hidden="true">
        <div className="kd-dotgrid" />
        <AsciiField preset="hero" />
      </div>
      <div className="kd-hero__in">
        <Row set={TOP} at="top" />
        <div className="kd-logo-row">
          <Trail n={3} />
          <h1 id="kd-hero-title" className="kd-logo" aria-label="KDRIVE">
            <KMark size={104} className="kd-logo__mark" />
            <span className="kd-logo__word" aria-hidden="true">
              KDRIVE
            </span>
          </h1>
          <Trail n={3} />
        </div>
        <p className="kd-hero__tag">
          The drive that <em>remembers.</em>
        </p>
        <p className="kd-hero__sub">
          A cloud drive where every change is a version. Go back to any version, compare, restore, and undo it.
        </p>
        <div className="kd-hero__ctas">
          <Link href={signedIn ? DRIVE_HREF : SIGNUP_HREF} className="kd-btn kd-btn--primary kd-btn--lg">
            {signedIn ? 'Open your drive' : 'Start with 10 GB free'}
          </Link>
          <a href="#time-travel" className="kd-btn kd-btn--secondary kd-btn--lg">
            See it in action
          </a>
        </div>
        <a href="#agents" className="kd-hero__agents">
          <Bot size={16} strokeWidth={1.7} aria-hidden />
          <span>
            Works with AI agents over MCP<span className="kd-hide-s">. By default they propose, you review.</span>
          </span>
        </a>
        <Row set={BOTTOM} at="bot" />
        <HeroStrip />
      </div>
    </section>
  );
}
