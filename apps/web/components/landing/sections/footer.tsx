import Link from 'next/link';
import { DRIVE_HREF, SIGNIN_HREF, sectionHref } from '../cta';
import { LogoMark } from '../logo-mark';

// The footer (LANDING-SPEC §6.9): brand block, two link columns, copyright.
// No giant wordmark, and no links to pages that don't exist yet.
export function Footer({ signedIn, home = true }: { signedIn: boolean; home?: boolean }) {
  const s = (href: string) => sectionHref(href, home);
  return (
    <footer className="kd-footer">
      <div className="kd-container">
        <div className="kd-footer__top">
          <div className="kd-footer__brand">
            <a href={home ? '#top' : '/'} className="kd-nav__brand" aria-label={home ? 'KDRIVE, back to top' : 'KDRIVE home'}>
              <LogoMark />
              <span>KDRIVE</span>
            </a>
            <p className="kd-footer__tag">The drive that remembers.</p>
            <p className="kd-footer__built">Built on Platinum volumes.</p>
          </div>
          <nav className="kd-footer__cols" aria-label="Footer">
            <div>
              <p className="kd-footer__label">Product</p>
              <ul>
                <li>
                  <a href={s('#how')}>How it works</a>
                </li>
                <li>
                  <a href={s('#time-travel')}>Time travel</a>
                </li>
                <li>
                  <a href={s('#agents')}>Agents</a>
                </li>
                <li>
                  <Link href="/pricing">Pricing</Link>
                </li>
                <li>
                  <a href={s('#faq')}>FAQ</a>
                </li>
              </ul>
            </div>
            <div>
              <p className="kd-footer__label">Account</p>
              <ul>
                <li>
                  {signedIn ? <Link href={DRIVE_HREF}>Open your drive</Link> : <Link href={SIGNIN_HREF}>Sign in</Link>}
                </li>
                <li>
                  <Link href="/settings/agents">AI agent settings</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>
        <p className="kd-footer__copy">© 2026 KDRIVE</p>
      </div>
    </footer>
  );
}
