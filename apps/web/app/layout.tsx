import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/shell/toaster';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Volumes', template: '%s · Volumes' },
  description: 'A personal drive where every change is a version you can browse, compare, restore or share.',
};

export const viewport: Viewport = { themeColor: '#0a0a0c', colorScheme: 'dark light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Pre-paint: dark unless localStorage['vx-theme'] === 'light' (never prefers-color-scheme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
