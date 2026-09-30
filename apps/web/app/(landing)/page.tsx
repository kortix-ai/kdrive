import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Hero } from '@/components/landing/hero/hero';
import { Nav } from '@/components/landing/nav';
import { Agents } from '@/components/landing/sections/agents';
import { Docked } from '@/components/landing/sections/docked';
import { Facts } from '@/components/landing/sections/facts';
import { Faq } from '@/components/landing/sections/faq';
import { Features } from '@/components/landing/sections/features';
import { FinalCta } from '@/components/landing/sections/final-cta';
import { Footer } from '@/components/landing/sections/footer';
import { How } from '@/components/landing/sections/how';
import { TimeTravel } from '@/components/landing/sections/time-travel';
import { UnderHood } from '@/components/landing/sections/under-hood';

const TITLE = 'KDRIVE — The drive that remembers.';
const DESCRIPTION =
  'A cloud drive where every change is a version. Travel back, compare, restore, and let AI agents propose changes you review.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'KDRIVE' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// better-auth session cookie: `advanced.cookiePrefix: 'vx'` in apps/api/src/auth,
// with the `__Secure-` prefix when secure cookies are on. Presence only: the
// label is a hint, and /drive does the real auth check.
const SESSION_COOKIES = ['vx.session_token', '__Secure-vx.session_token'];

export default async function LandingPage() {
  const jar = await cookies();
  const signedIn = SESSION_COOKIES.some((name) => jar.has(name));

  return (
    <>
      <Nav signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} />
        <Facts />
        <How />
        <TimeTravel />
        <Docked />
        <Agents />
        <Features />
        <UnderHood />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
    </>
  );
}
