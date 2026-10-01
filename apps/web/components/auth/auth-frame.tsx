import { cx } from '@/components/ui/cx';

/**
 * The ground for sign-in, OAuth and the 404 (UNIFY-SPEC §14.1): the page colour with the landing's static
 * atmosphere (a violet tint from above, a floor glow below) and grain at half strength. No canvas.
 */
export function AuthFrame({ children, className, bar }: { children: React.ReactNode; className?: string; bar?: React.ReactNode }) {
  return (
    <div className={cx('vx-atmos vx-grain relative flex h-dvh flex-col items-center overflow-auto px-4 py-10 max-[720px]:p-0', !!bar && 'pt-14 max-[720px]:pt-14', className)}>
      {/* The chrome-less bar (404): the app top bar's 56 px row, lockup left, actions right. */}
      {bar ? <header className="absolute inset-x-0 top-0 z-[2] flex h-14 items-center justify-between gap-3 px-4">{bar}</header> : null}
      <div className="my-auto flex w-full flex-col items-center max-[720px]:my-0 max-[720px]:min-h-full">{children}</div>
    </div>
  );
}

/** The one card on an auth page: surface, 1 px hair, r6, the landing's mock-window shadow. */
export function AuthCard({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cx(
        'relative z-[1] w-full overflow-hidden rounded-vx-lg border border-vx-hair bg-vx-surface shadow-vx-mock',
        'max-[720px]:flex-1 max-[720px]:rounded-none max-[720px]:border-0 max-[720px]:shadow-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
