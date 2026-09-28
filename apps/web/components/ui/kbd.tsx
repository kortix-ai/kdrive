import { cx } from './cx';

/**
 * A key hint chip (DESIGN-v2 §5): 20 px tall, r6, 11/500 Inter, surface + 1 px hair, text-3.
 * Inside a button (`inButton`) it is transparent with a currentColor border at .5.
 */
export function Kbd({ children, className, inButton }: { children: React.ReactNode; className?: string; inButton?: boolean }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-vx-xs border px-1.5 text-[11px] font-medium leading-none',
        inButton ? 'border-current/50 bg-transparent text-current opacity-70' : 'border-vx-hair bg-vx-surface text-vx-text-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export default Kbd;
