import { PrimaryCta } from '../cta';
import { LogoMark } from '../logo-mark';
import { Poster } from './poster';
import { HeroSceneLoader } from './scene-loader';

// STUB (owned by the HERO builder): LANDING-SPEC §5. Server component: copy,
// SSR poster, sr-only scene description; the WebGL scene mounts client-side.
export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="top" className="kd-hero" aria-labelledby="kd-hero-title">
      <div className="kd-hero__atmos" aria-hidden="true" />
      <Poster />
      <HeroSceneLoader />
      <div className="kd-hero__copy">
        <p className="kd-eyebrow">Versioned cloud drive</p>
        <h1 id="kd-hero-title">
          <span className="kd-wordmark kd-metal">
            <LogoMark size={48} className="kd-hero__mark" />
            KDRIVE
          </span>
          <span className="kd-tagline">
            The drive that <em className="kd-metal">remembers.</em>
          </span>
        </h1>
        <p className="kd-hero__sub">
          A cloud drive where every change is a version. Travel back, compare, restore — and undo the restore.
        </p>
        <div className="kd-hero__ctas">
          <PrimaryCta signedIn={signedIn} />
          <a href="#how" className="kd-btn kd-btn--ghost">
            See how it works
          </a>
        </div>
        <a href="#agents" className="kd-hero__agents">
          Works with AI agents over MCP: they propose, you review →
        </a>
      </div>
      <p className="kd-sr-only">
        Decorative scene: grey isometric cubes, each one a drive, float around the KDRIVE name. Clicking one fans it
        out into its stack of versions.
      </p>
    </section>
  );
}
