import Link from 'next/link';
import { PrimaryCta } from '../cta';

// The final call to action (LANDING-SPEC §6.8): full bleed, no box, the hero's
// violet atmosphere plus grain. Pure type, both lines centred: the hero keeps
// the page's one logo moment.
export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="kd-final" aria-labelledby="kd-final-title">
      <div className="kd-final__atmos" aria-hidden="true" />
      <div className="kd-container kd-final__inner kd-reveal">
        <h2 id="kd-final-title" className="kd-final__title">
          <span>Change anything.</span>
          <span className="kd-metal">Go back to how it was.</span>
        </h2>
        <p className="kd-final__sub">Start with 10 GB. Versioning is on from your first upload.</p>
        <div className="kd-final__ctas">
          <PrimaryCta signedIn={signedIn} />
          <Link href="/settings/agents" className="kd-btn kd-btn--ghost">
            Connect an agent
          </Link>
        </div>
      </div>
    </section>
  );
}
