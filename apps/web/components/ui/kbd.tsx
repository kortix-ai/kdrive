import { cx } from './cx';

/** One casing for every key hint: single letters are capitals ("N", "G then D"); everything else is as written ("Esc", "⌘K"). */
function keyText(children: React.ReactNode): React.ReactNode {
  return typeof children === 'string' && /^[a-z]$/.test(children) ? children.toUpperCase() : children;
}

/**
 * A key hint chip: Mono 11/500, 20 px tall, 5 px corners, padding 0 5, a surface keycap (hair-strong edge and
 * a 1 px bottom lip), text-2.
 * Inside a button (`inButton`) it is transparent with a currentColor border, at .7, and it is hidden on touch
 * screens (`.vx-kbd-hint`), where there is no keyboard to press it with.
 */
export function Kbd({ children, className, inButton, hint }: { children: React.ReactNode; className?: string; inButton?: boolean; hint?: boolean }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] border px-[5px] font-mono text-[11px] font-medium leading-none',
        inButton ? 'h-[18px] min-w-[18px] border-current/50 bg-transparent text-current opacity-70' : 'border-vx-hair-strong bg-vx-surface text-vx-text-2 shadow-[0_1px_0_var(--vx-hair-strong)]',
        (inButton || hint) && 'vx-kbd-hint',
        className,
      )}
    >
      {keyText(children)}
    </kbd>
  );
}

export default Kbd;
