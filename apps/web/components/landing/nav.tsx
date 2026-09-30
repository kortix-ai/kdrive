'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PrimaryCta, SIGNIN_HREF } from './cta';
import { LogoMark } from './logo-mark';

// STUB (owned by the SECTIONS builder): full-width fixed bar, LANDING-SPEC §4.
const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#time-travel', label: 'Time travel' },
  { href: '#agents', label: 'Agents' },
  { href: '#under-the-hood', label: 'Under the hood' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY >= 8);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header className={`kd-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="kd-container kd-nav__inner">
        <a href="#top" className="kd-nav__brand">
          <LogoMark />
          KDRIVE
        </a>
        <nav className="kd-nav__links" aria-label="Sections">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="kd-nav__right">
          {!signedIn && (
            <Link href={SIGNIN_HREF} className="kd-nav__signin">
              Sign in
            </Link>
          )}
          <PrimaryCta signedIn={signedIn} />
        </div>
      </div>
    </header>
  );
}
