import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { AsciiField } from '@/components/landing/ascii-field';
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

const TITLE = 'KDRIVE · The drive that remembers.';
const DESCRIPTION =
  'A cloud drive where every change is a version. Go back to any version, compare, restore, and let AI agents propose changes you review.';

/** This request's own origin (proxy headers first), so share cards and the MCP snippet point at this deployment. */
async function requestOrigin(): Promise<string | undefined> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return undefined;
  const proto = h.get('x-forwarded-proto')?.split(',')[0] ?? (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { absolute: TITLE },
    description: DESCRIPTION,
    openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'KDRIVE' },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  };
}

// better-auth session cookie: `advanced.cookiePrefix: 'vx'` in apps/api/src/auth,
// with the `__Secure-` prefix when secure cookies are on. Presence only: the
// label is a hint, and /drive does the real auth check.
const SESSION_COOKIES = ['vx.session_token', '__Secure-vx.session_token'];

export default async function LandingPage() {
  const jar = await cookies();
  const signedIn = SESSION_COOKIES.some((name) => jar.has(name));
  // the agents snippet shows this deployment's real MCP endpoint, so Copy gives something usable
  const origin = await requestOrigin();
  const mcpUrl = origin ? `${origin}/mcp` : undefined;

  return (
    <>
      <Nav signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} />
        <div className="kd-break" aria-hidden="true">
          <AsciiField band={[32, 205]} />
        </div>
        {/* orientation first (the four moves, then what is kept), then the product proof */}
        <How />
        <Facts />
        <TimeTravel />
        <Docked />
        <Agents mcpUrl={mcpUrl} />
        <Features />
        <div className="kd-break" aria-hidden="true">
          <AsciiField band={[162, 352]} />
        </div>
        <UnderHood />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
    </>
  );
}
