import { DESKTOP, MOBILE, TABLET } from './engine/layout';
import { posterSvg } from './poster-art';

// The SSR poster (LANDING-SPEC §5.7): both reference compositions, rendered
// once per server process from the same layout as the scene. A media query
// picks one (aspect < 0.9 → mobile). The scene client fades it out after the
// first WebGL frame and then empties it; without WebGL it stays.
const DESKTOP_SVG = posterSvg(DESKTOP, 1440, 900);
// tablets and tall windows: the hero is capped at 1000px tall
const TABLET_SVG = posterSvg(TABLET, 820, 1000);
// phones: two bands of cubes, above and below the copy, inside 100svh
const MOBILE_SVG = posterSvg(MOBILE, 390, 844);

export function Poster() {
  return (
    <div className="kd-hero__poster" aria-hidden="true">
      <div className="kd-hero__poster-art kd-hero__poster-art--wide" dangerouslySetInnerHTML={{ __html: DESKTOP_SVG }} />
      <div className="kd-hero__poster-art kd-hero__poster-art--mid" dangerouslySetInnerHTML={{ __html: TABLET_SVG }} />
      <div className="kd-hero__poster-art kd-hero__poster-art--tall" dangerouslySetInnerHTML={{ __html: MOBILE_SVG }} />
    </div>
  );
}
