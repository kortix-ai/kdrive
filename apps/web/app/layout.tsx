import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Toaster } from '@/components/shell/toaster';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
import './globals.css';

const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-geist', display: 'swap' });
// Data and labels (sizes, dates, ids, eyebrows, kbd, code) on every surface, landing included.
const mono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-kd-mono', display: 'swap' });
// Headline accent: one emphasised word, italic.
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-kd-display', display: 'swap' });

export const metadata: Metadata = {
  // Fallback for absolute share-card URLs; the landing sets its own from each request's origin.
  // BETTER_AUTH_URL is the web origin (auth lives on this origin, see .env.example).
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:4100'),
  title: { default: 'KDRIVE', template: '%s · KDRIVE' },
  description: 'KDRIVE: the drive that remembers. Every change is a version you can browse, compare, restore or share.',
};

// Dark is the default on every device; the boot script corrects the colour for a stored light choice.
export const viewport: Viewport = { themeColor: '#1a1917', colorScheme: 'dark light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable} ${display.variable}`} data-vx-theme="dark" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        {/* Pre-paint: dark unless the stored preference is light, or system on a light device. Also syncs tabs. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/* Extensions add attributes to <body> before hydration; do not report those as mismatches. */}
      <body suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
