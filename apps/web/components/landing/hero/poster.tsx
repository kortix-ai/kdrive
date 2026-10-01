import { DESKTOP, MOBILE, TABLET } from './engine/layout';
import { SCENE_DARK, SCENE_LIGHT } from './engine/palette';
import { posterSvg } from './poster-art';

// The SSR poster (LANDING-SPEC §5.7, UNIFY-SPEC §13.3): the three reference compositions, rendered once per
// server process from the same layout as the scene, in both theme palettes. A media query picks the
// composition (aspect < 0.9 → mobile) and html[data-vx-theme] picks the palette, so no client JS decides
// which poster shows and there is no flash. The scene client fades it out after the first WebGL frame and
// then empties it; without WebGL it stays.
const ART = [SCENE_DARK, SCENE_LIGHT].map((p) => ({
  theme: p.name,
  // desktop; tablets and tall windows (the hero is capped at 1000px tall); phones (two bands of cubes)
  wide: posterSvg(DESKTOP, 1440, 900, p),
  mid: posterSvg(TABLET, 820, 1000, p),
  tall: posterSvg(MOBILE, 390, 844, p),
}));

export function Poster() {
  return (
    <div className="kd-hero__poster" aria-hidden="true">
      {ART.map((a) => (
        <div key={a.theme} className={`kd-hero__poster-set vx-when-${a.theme}`}>
          <div className="kd-hero__poster-art kd-hero__poster-art--wide" dangerouslySetInnerHTML={{ __html: a.wide }} />
          <div className="kd-hero__poster-art kd-hero__poster-art--mid" dangerouslySetInnerHTML={{ __html: a.mid }} />
          <div className="kd-hero__poster-art kd-hero__poster-art--tall" dangerouslySetInnerHTML={{ __html: a.tall }} />
        </div>
      ))}
    </div>
  );
}
