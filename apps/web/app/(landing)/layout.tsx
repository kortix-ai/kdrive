import type { Viewport } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './landing.css';
import './landing-hero.css';
import './landing-sections.css';

// The public KDRIVE landing (LANDING-SPEC §8). Its own route group, so it never
// inherits the signed-in AppShell or its auth guard. Tokens are scoped to the
// `.kd` wrapper; the root layout's data-vx-theme and the app's light theme are
// left untouched.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-kd-mono',
  display: 'swap',
});

export const viewport: Viewport = { themeColor: '#0a0a0b', colorScheme: 'dark' };

// Marks the document as JS-capable before paint; reveal styles apply only under
// html[data-kd-js], so the SSR HTML is fully visible without JS.
const KD_JS_SCRIPT = "document.documentElement.setAttribute('data-kd-js','')";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`kd ${mono.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: KD_JS_SCRIPT }} />
      {children}
    </div>
  );
}
