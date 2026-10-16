import { AsciiField } from '@/components/auth/ascii-field';
import { SignInArt } from '@/components/auth/sign-in-art';
import { cx } from '@/components/ui/cx';

/** The notebook: a 24 px dot grid on the paper. */
export function DotGrid({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx('pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage: 'radial-gradient(circle at 1.25px 1.25px, var(--vx-dot) 1.25px, transparent 1.7px)',
        backgroundSize: '24px 24px',
        backgroundPosition: 'center 0',
      }}
    />
  );
}

/**
 * The ground for sign-in, password reset, OAuth consent and the 404: warm paper with the dot grid, the ASCII grain
 * at the edges and (on wide screens) four glass objects around the card. `bar` fills the top row (lockup left,
 * actions right), `foot` the bottom row. `objects={false}` keeps the paper and grain but drops the objects.
 */
export function AuthFrame({
  children,
  className,
  bar,
  foot,
  objects = true,
}: {
  children: React.ReactNode;
  className?: string;
  bar?: React.ReactNode;
  foot?: React.ReactNode;
  objects?: boolean;
}) {
  return (
    <div className={cx('relative h-dvh overflow-y-auto overflow-x-hidden bg-vx-bg', className)}>
      <div className="relative isolate grid min-h-full grid-rows-[auto_1fr_auto]">
        <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
          <DotGrid />
          <AsciiField preset="auth" />
        </div>
        {objects ? <SignInArt /> : null}
        {bar ? (
          <header className="relative z-[4] flex min-h-[72px] items-center justify-between gap-4 px-8 py-4 max-[720px]:min-h-14 max-[720px]:px-4 max-[720px]:py-2.5">
            {bar}
          </header>
        ) : (
          <span />
        )}
        <div className="relative z-[4] flex min-w-0 flex-col items-center justify-center px-6 py-4 max-[720px]:justify-start max-[720px]:px-4 max-[720px]:pb-4 max-[720px]:pt-2">
          {children}
        </div>
        {foot ? (
          <footer className="relative z-[4] flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-5 py-5 text-[13.5px] leading-5 text-vx-text-3">{foot}</footer>
        ) : (
          <span className="h-6" />
        )}
      </div>
    </div>
  );
}

/**
 * The one card on an auth page: frosted surface over the paper (so the grain softens through it), a hair edge,
 * a 22 px radius and the deep float shadow. Padding is the caller's.
 */
export function AuthCard({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cx(
        'relative z-[1] w-full rounded-[var(--vx-r-xl)] border border-vx-hair',
        'bg-[color-mix(in_oklab,var(--vx-surface)_90%,transparent)] shadow-[var(--vx-shadow-4),inset_0_1px_0_var(--vx-glass-hi)] backdrop-blur-[22px] backdrop-saturate-[1.2]',
        'max-[720px]:rounded-[20px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
