import './landing.css';
import './landing-hero.css';
import './landing-sections.css';
import { LandingTheme } from '@/components/landing/landing-theme';

// The public KDRIVE landing. Its own route group, so it never inherits the signed-in AppShell or its auth
// guard. Colours come from the shared --vx-* tokens (aliased as --kd-* in landing.css), so the landing follows
// the one theme preference; with nothing stored it opens light (the app defaults to dark). Fonts (Geist,
// Geist Mono, Instrument Serif) load in the root layout.

// Marks the document as JS-capable before paint; reveal styles apply only under
// html[data-kd-js], so the SSR HTML is fully visible without JS.
const KD_JS_SCRIPT = "document.documentElement.setAttribute('data-kd-js','')";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kd">
      <script dangerouslySetInnerHTML={{ __html: KD_JS_SCRIPT }} />
      <LandingTheme />
      {children}
    </div>
  );
}
