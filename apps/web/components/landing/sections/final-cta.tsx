import Link from 'next/link';
import { KMark } from '@/components/brand/k-mark';
import { AsciiField } from '../ascii-field';
import { PrimaryCta } from '../cta';

// The final call to action: a paper panel on the same oat ground, the dot grid and a neutral grey ASCII grain
// at its sides (no gradient band), the K, one line with its serif half, and the two ways in.
export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="kd-final" aria-labelledby="kd-final-title">
      <div className="kd-final__panel kd-reveal">
        <div className="kd-dotgrid" aria-hidden="true" />
        <AsciiField preset="final" />
        <div className="kd-final__inner">
          <KMark size={60} />
          <h2 id="kd-final-title" className="kd-final__title">
            Change anything. <em className="kd-serif">Go back to how it was.</em>
          </h2>
          <p className="kd-final__sub">Start with 10 GB. Versioning is on from your first upload.</p>
          <div className="kd-final__ctas">
            <PrimaryCta signedIn={signedIn} label="Get started free" className="kd-btn--lg" />
            <Link href="/settings/agents" className="kd-btn kd-btn--secondary kd-btn--lg">
              Connect an agent
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
