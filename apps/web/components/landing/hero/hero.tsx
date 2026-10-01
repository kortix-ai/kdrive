import { PrimaryCta } from '../cta';
import { LogoMark } from '../logo-mark';
import { Poster } from './poster';
import { HeroSceneLoader } from './scene-loader';

// The hero (LANDING-SPEC §5). Server component: atmosphere, the SSR poster,
// the copy and the scene description. The WebGL layer (canvas, cursor glow,
// labels, hint) mounts client-side through HeroSceneLoader.
// Layers, back to front: atmosphere, poster, canvas, grain, copy, hint.
export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="top" className="kd-hero" aria-labelledby="kd-hero-title">
      <div className="kd-hero__atmos" aria-hidden="true" />
      <Poster />
      <HeroSceneLoader />
      <div className="kd-hero__copy">
        <p className="kd-eyebrow kd-hero__eyebrow">Versioned cloud drive</p>
        <h1 id="kd-hero-title" className="kd-hero__title">
          <span className="kd-wordmark">
            <LogoMark size={64} variant="metal" className="kd-hero__mark" />
            <span className="kd-metal">KDRIVE</span>
          </span>
          <span className="kd-tagline">
            The drive that <em className="kd-metal">remembers.</em>
          </span>
        </h1>
        <p className="kd-sr-only">
          Illustration: metal cubes float around the name, each one a drive. Opening one fans out its recent versions
          like a timeline.
        </p>
        <p className="kd-hero__sub">
          A cloud drive where every change is a version.
          <br className="kd-hero__br" /> Go back to any version, compare, restore — and undo it.
        </p>
        <div className="kd-hero__ctas">
          <PrimaryCta signedIn={signedIn} />
          <a href="#time-travel" className="kd-btn kd-btn--ghost">
            See it in action
          </a>
        </div>
        <a href="#agents" className="kd-hero__agents">
          Works with AI agents over MCP: by default they propose, you review →
        </a>
      </div>
    </section>
  );
}
