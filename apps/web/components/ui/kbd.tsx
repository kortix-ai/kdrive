import { cx } from './cx';

/**
 * A key hint chip (UNIFY-SPEC §10): Mono 11/500, 18 px tall, r2, padding 0 5, surface-3 + 1 px hair, text-3.
 * Inside a button (`inButton`) it is transparent with a currentColor border, at .7.
 */
export function Kbd({ children, className, inButton }: { children: React.ReactNode; className?: string; inButton?: boolean }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-vx-xs border px-[5px] font-mono text-[11px] font-medium leading-none',
        inButton ? 'border-current/50 bg-transparent text-current opacity-70' : 'border-vx-hair bg-vx-surface-3 text-vx-text-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export default Kbd;
