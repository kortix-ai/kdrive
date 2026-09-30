import Link from 'next/link';
import { DRIVE_HREF, SIGNIN_HREF } from '../cta';
import { LogoMark } from '../logo-mark';

// STUB (owned by the SECTIONS builder): LANDING-SPEC §6.9.
export function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="kd-footer">
      <div className="kd-container">
        <p>
          <LogoMark /> KDRIVE
        </p>
        <p>The drive that remembers.</p>
        <p className="kd-eyebrow">Built on Platinum volumes.</p>
        <nav aria-label="Footer">
          <a href="#how">How it works</a> · <a href="#time-travel">Time travel</a> · <a href="#agents">Agents</a> ·{' '}
          <a href="#faq">FAQ</a> ·{' '}
          {signedIn ? <Link href={DRIVE_HREF}>Open your drive</Link> : <Link href={SIGNIN_HREF}>Sign in</Link>} ·{' '}
          <Link href="/settings/agents">AI agent settings</Link>
        </nav>
        <p className="kd-eyebrow">© 2026 KDRIVE</p>
      </div>
    </footer>
  );
}
