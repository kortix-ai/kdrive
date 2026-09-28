'use client';

import { useRef, useState } from 'react';
import { cx } from './cx';
import { Kbd } from './kbd';

/** Hover / focus tooltip (400 ms delay): a label, optionally with a key hint. */
export function Tooltip({ label, kbd, children, side = 'top' }: { label: React.ReactNode; kbd?: string; children: React.ReactNode; side?: 'top' | 'bottom' | 'right' }) {
  const [open, setOpen] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    t.current = setTimeout(() => setOpen(true), 400);
  };
  const hide = () => {
    if (t.current) clearTimeout(t.current);
    setOpen(false);
  };
  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {open ? (
        <span
          role="tooltip"
          className={cx(
            'pointer-events-none absolute z-[70] flex items-center gap-2 whitespace-nowrap border border-vx-hair-strong bg-vx-float px-2 py-1 font-mono text-[11px] text-vx-text-2',
            side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
            side === 'bottom' && 'top-full left-1/2 mt-1.5 -translate-x-1/2',
            side === 'right' && 'left-full top-1/2 ml-1.5 -translate-y-1/2',
          )}
        >
          {label}
          {kbd ? <Kbd>{kbd}</Kbd> : null}
        </span>
      ) : null}
    </span>
  );
}

export default Tooltip;
