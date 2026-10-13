import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Nav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/sections/footer';
import { PricingPlans } from '@/components/pricing/pricing-plans';
import './pricing.css';

// /pricing: the three plans in the landing's language (same nav, type and hairlines), for
// signed-out visitors (each card leads to sign-up) and signed-in people (their plan is
// marked; paid plans are requested, or bought through Stripe once billing is configured).

const TITLE = 'Pricing · KDRIVE';
const DESCRIPTION = 'Start with 10 GB free. Plus gives you 100 GB, Pro 1 TB. Every plan keeps every version.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'KDRIVE' },
};

// Same presence check as the landing (app/(landing)/page.tsx): a hint only, the API decides.
const SESSION_COOKIES = ['vx.session_token', '__Secure-vx.session_token'];

const NOTES = [
  { q: 'What does storage count?', a: "What your drives hold now. Past versions and checkpoints don't use it, so history never eats your space." },
  { q: 'What if I go over?', a: 'Nothing is deleted. Uploads that would not fit are refused until you free space or move to a bigger plan.' },
  { q: 'Can I go back to Free?', a: 'Yes. Your files stay; uploads pause while your drives hold more than 10 GB.' },
];

export default async function PricingPage() {
  const jar = await cookies();
  const signedIn = SESSION_COOKIES.some((name) => jar.has(name));
  return (
    <>
      <Nav signedIn={signedIn} home={false} />
      <main>
        <section id="top" className="kd-pricing" aria-labelledby="pricing-title">
          <div className="kd-pricing__atmos" aria-hidden="true" />
          <div className="kd-container">
            <header className="kd-head kd-head--large kd-pricing__head">
              <p className="kd-eyebrow">Pricing</p>
              <h1 id="pricing-title" className="kd-h2">
                Room for everything <span className="kd-metal">you keep.</span>
              </h1>
              <p className="kd-lead">Start with 10 GB free. Every plan keeps every version, every checkpoint and every share link.</p>
            </header>
            <PricingPlans signedIn={signedIn} />
            <dl className="kd-pricing__notes">
              {NOTES.map((n) => (
                <div key={n.q}>
                  <dt className="kd-h3">{n.q}</dt>
                  <dd>{n.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <Footer signedIn={signedIn} home={false} />
    </>
  );
}
