import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/shell/toaster';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
import './globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' });
// Data and labels (sizes, dates, ids, eyebrows, kbd, code) on every surface, landing included.
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-kd-mono', display: 'swap' });

export const metadata: Metadata = {
  // Fallback for absolute share-card URLs; the landing sets its own from each request's origin.
  // BETTER_AUTH_URL is the web origin (auth lives on this origin, see .env.example).
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:4100'),
  title: { default: 'KDRIVE', template: '%s · KDRIVE' },
  description: 'KDRIVE: the drive that remembers. Every change is a version you can browse, compare, restore or share.',
};

// Dark is the default on every device; the boot script corrects the colour for a stored light choice.
export const viewport: Viewport = { themeColor: '#0a0a0b', colorScheme: 'dark light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} data-vx-theme="dark" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
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
