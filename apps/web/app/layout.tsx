import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/shell/toaster';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
import './globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Volumes', template: '%s · Volumes' },
  description: 'A personal drive where every change is a version you can browse, compare, restore or share.',
};

// Light is the default theme on every device (DESIGN-v2 §2.1).
export const viewport: Viewport = { themeColor: '#faf9f7', colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-vx-theme="light" suppressHydrationWarning>
      <head>
        {/* Pre-paint: light unless the stored preference is dark, or system on a dark device. */}
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
