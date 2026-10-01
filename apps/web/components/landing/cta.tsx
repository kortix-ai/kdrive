import Link from 'next/link';

/** Where every "Get started" / "Open your drive" button goes; the app sends signed-out users to sign in. */
export const DRIVE_HREF = '/drive';
export const SIGNIN_HREF = '/signin?next=/drive';

export function primaryCtaLabel(signedIn: boolean): string {
  return signedIn ? 'Open your drive' : 'Get started';
}

/** The primary landing button (LANDING-SPEC §7): the drive when signed in, otherwise straight to sign-in (then the drive). */
export function PrimaryCta({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <Link href={signedIn ? DRIVE_HREF : SIGNIN_HREF} className={`kd-btn kd-btn--primary${className ? ` ${className}` : ''}`}>
      {primaryCtaLabel(signedIn)}
      <span className="kd-btn__arrow" aria-hidden="true">→</span>
    </Link>
  );
}
