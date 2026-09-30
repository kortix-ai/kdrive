import Link from 'next/link';
import { PrimaryCta } from '../cta';

// STUB (owned by the SECTIONS builder): LANDING-SPEC §6.8.
export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="kd-section kd-final" aria-labelledby="kd-final-title">
      <div className="kd-container">
        <h2 id="kd-final-title">
          Change anything.
          <br />
          <span className="kd-metal">Go back to any version.</span>
        </h2>
        <p>Start with 10 GB. Every version from the first one.</p>
        <div className="kd-hero__ctas">
          <PrimaryCta signedIn={signedIn} />
          <Link href="/settings/agents" className="kd-btn kd-btn--ghost">
            Connect an agent
          </Link>
        </div>
      </div>
    </section>
  );
}
