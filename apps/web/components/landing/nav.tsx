'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { PrimaryCta, SIGNIN_HREF, sectionHref } from './cta';
import { LogoMark } from './logo-mark';
import { useReveal } from './use-reveal';

// The bar: sticky frosted paper with a hairline. Links centre on desktop and fold into a sheet under ≤960px.
// It also hosts the page's section reveal observer, since it is the landing's one always-mounted client island.
// Plain words in the bar; the section numbers live only on the eyebrows.
const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#time-travel', label: 'Time travel' },
  { href: '#agents', label: 'Agents' },
  { href: '#under-the-hood', label: 'Under the hood' },
  { href: '/pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

/** `home`: the bar sits on the landing itself (its anchors scroll); false on other public pages. */
export function Nav({ signedIn, home = true }: { signedIn: boolean; home?: boolean }) {
  const [open, setOpen] = useState(false);
  useReveal();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 960) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const link = (l: (typeof LINKS)[number], onClick?: () => void) =>
    l.href.startsWith('/') ? (
      <Link key={l.href} href={l.href} onClick={onClick} aria-current={!home && l.href === '/pricing' ? 'page' : undefined}>
        {l.label}
      </Link>
    ) : (
      <a key={l.href} href={sectionHref(l.href, home)} onClick={onClick}>
        {l.label}
      </a>
    );

  return (
    <>
      <a href="#top" className="kd-skip">
        Skip to content
      </a>
      <header className={`kd-nav${open ? ' is-open' : ''}`}>
        <div className="kd-container kd-nav__inner">
          <a href={home ? '#top' : '/'} className="kd-nav__brand" aria-label={home ? 'KDRIVE, back to top' : 'KDRIVE home'}>
            <LogoMark size={22} />
            <span>KDRIVE</span>
          </a>
          <nav className="kd-nav__links" aria-label="Sections">
            {LINKS.map((l) => link(l))}
          </nav>
          <div className="kd-nav__right">
            <ThemeToggle className="kd-nav__theme" />
            {!signedIn && (
              <Link href={SIGNIN_HREF} className="kd-btn kd-btn--plain kd-nav__signin">
                Sign in
              </Link>
            )}
            <PrimaryCta signedIn={signedIn} className="kd-nav__cta" />
            <button
              type="button"
              className="kd-nav__menu"
              aria-label={open ? 'Close menu' : 'Menu'}
              aria-expanded={open}
              aria-controls="kd-nav-sheet"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X size={20} strokeWidth={1.7} aria-hidden /> : <Menu size={20} strokeWidth={1.7} aria-hidden />}
            </button>
          </div>
        </div>
        <nav id="kd-nav-sheet" className="kd-sheet" aria-label="Menu" hidden={!open}>
          {LINKS.map((l) => link(l, () => setOpen(false)))}
          {!signedIn && (
            <Link href={SIGNIN_HREF} onClick={() => setOpen(false)}>
              Sign in
            </Link>
          )}
        </nav>
      </header>
    </>
  );
}
