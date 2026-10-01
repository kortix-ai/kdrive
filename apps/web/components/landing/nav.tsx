'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { PrimaryCta, SIGNIN_HREF } from './cta';
import { LogoMark } from './logo-mark';
import { useReveal } from './use-reveal';

// The full-width fixed bar (LANDING-SPEC §4): transparent at the top, a
// blurred solid bar with a hairline and a 24px scrim once scrolled. One passive
// scroll listener, read once per frame. It also hosts the page's section
// reveal observer, since it is the landing's one always-mounted client island.
// Plain words in the bar; the section numbers live only on the eyebrows.
const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#time-travel', label: 'Time travel' },
  { href: '#agents', label: 'Agents' },
  { href: '#under-the-hood', label: 'Under the hood' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  // the CTA is a hairline ghost over the hero (whose own CTA leads) and turns solid once it scrolls out
  const [past, setPast] = useState(false);
  useReveal();

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY >= 8);
      const hero = document.getElementById('top');
      setPast(!!hero && hero.getBoundingClientRect().bottom < 120);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <a href="#top" className="kd-skip">
        Skip to content
      </a>
      <header className={`kd-nav${scrolled ? ' kd-nav--scrolled' : ''}${past ? ' kd-nav--past' : ''}`}>
        <div className="kd-container kd-nav__inner">
          <a href="#top" className="kd-nav__brand" aria-label="KDRIVE, back to top">
            <LogoMark />
            <span>KDRIVE</span>
          </a>
          <nav className="kd-nav__links" aria-label="Sections">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="kd-nav__right">
            <ThemeToggle className="kd-nav__theme" />
            {!signedIn && (
              <Link href={SIGNIN_HREF} className="kd-nav__signin">
                Sign in
              </Link>
            )}
            <PrimaryCta signedIn={signedIn} className="kd-nav__cta" />
          </div>
        </div>
        <div className="kd-nav__scrim" aria-hidden="true" />
      </header>
    </>
  );
}
