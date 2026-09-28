'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

type Side = 'top' | 'bottom' | 'right' | 'left';

// "Warm" window: once a tooltip has shown, siblings show at once (DESIGN-v2 §5: 0 ms between siblings).
let warmUntil = 0;

/**
 * Small tooltip (DESIGN-v2 §5): inverse fill, r6, 12/16, optional key hint.
 * 400 ms delay, instant between siblings, portalled so sheets never clip it.
 */
export function Tooltip({
  label,
  kbd,
  children,
  side = 'top',
  className,
}: {
  label: React.ReactNode;
  kbd?: string;
  children: React.ReactNode;
  side?: Side;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (t.current) clearTimeout(t.current);
    if (Date.now() < warmUntil) setOpen(true);
    else t.current = setTimeout(() => setOpen(true), 400);
  };
  const hide = () => {
    if (t.current) clearTimeout(t.current);
    if (open) warmUntil = Date.now() + 300;
    setOpen(false);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = tip.current.getBoundingClientRect();
    const gap = 6;
    let left = a.left + a.width / 2 - b.width / 2;
    let top = side === 'bottom' ? a.bottom + gap : a.top - b.height - gap;
    if (side === 'right') {
      left = a.right + gap;
      top = a.top + a.height / 2 - b.height / 2;
    } else if (side === 'left') {
      left = a.left - b.width - gap;
      top = a.top + a.height / 2 - b.height / 2;
    }
    if (side === 'top' && top < 8) top = a.bottom + gap;
    if (side === 'bottom' && top + b.height > window.innerHeight - 8) top = a.top - b.height - gap;
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - b.height - 8));
    setPos({ left, top });
  }, [open, side, label]);

  return (
    <span
      ref={anchor}
      className={cx('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onMouseDown={hide}
    >
      {children}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <span
              ref={tip}
              role="tooltip"
              style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, opacity: 0 }}
              className="dlg-fade pointer-events-none fixed z-[90] flex max-w-[320px] items-center gap-2 rounded-vx-xs bg-vx-inverse px-2.5 py-1.5 text-[12px] leading-4 text-vx-on-inverse"
            >
              <span className="min-w-0">{label}</span>
              {kbd ? <span className="shrink-0 rounded-[4px] border border-current/50 px-1 text-[11px] font-medium opacity-70">{kbd}</span> : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export default Tooltip;
