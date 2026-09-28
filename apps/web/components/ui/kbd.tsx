import { cx } from './cx';

/** A key hint chip: 1 px hairline, 10 px mono, 18 px tall. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center border border-vx-hair px-1 text-[10px] leading-none text-vx-text-4',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export default Kbd;
