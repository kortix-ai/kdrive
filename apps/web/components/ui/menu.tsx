'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cx } from './cx';

export type MenuItem =
  | {
      type?: 'item';
      id: string;
      label: React.ReactNode;
      /** 18 px lucide icon. */
      icon?: React.ReactNode;
      /** Key hint on the right (11 px text-4). */
      kbd?: string;
      onSelect: () => void;
      /** Destructive: del-fg text and icon. */
      danger?: boolean;
      /** `past` colours the icon amber (restore items). */
      tone?: 'danger' | 'past';
      disabled?: boolean;
      /** Why it is disabled (tooltip). */
      reason?: string;
      /** Leading accent ✓. */
      checked?: boolean;
      /** A second, meta line under the label. */
      hint?: React.ReactNode;
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: React.ReactNode };

type ActionItem = Extract<MenuItem, { onSelect: () => void }>;

interface MenuListProps {
  items: MenuItem[];
  onClose: () => void;
  style?: React.CSSProperties;
  className?: string;
  /** Called after layout with the list element, to position it. */
  onMeasure?: (el: HTMLDivElement) => void;
  minWidth?: number;
}

/** The floating list (DESIGN-v2 §5 Menu): ↑ ↓ Home End ↵ Esc and type-ahead. */
function MenuList({ items, onClose, style, className, onMeasure, minWidth = 240 }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items.map((it, i) => ({ it, i })).filter(({ it }) => (it.type ?? 'item') === 'item' && !(it as ActionItem).disabled);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });

  useLayoutEffect(() => {
    if (ref.current) onMeasure?.(ref.current);
    // Measure once on open; the list does not change size while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const n = Math.max(1, actionable.length);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % n);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + n) % n);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActive(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActive(n - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = actionable[active]?.it as ActionItem | undefined;
        if (target) {
          onClose();
          target.onSelect();
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onClose();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
        // Type-ahead: jump to the next item whose text starts with what was typed.
        const now = Date.now();
        const t = typed.current;
        t.text = now - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
        t.at = now;
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []);
        const start = t.text.length === 1 ? active + 1 : active;
        for (let k = 0; k < buttons.length; k++) {
          const idx = (start + k) % buttons.length;
          const text = buttons[idx].querySelector('[data-menu-label]')?.textContent?.trim().toLowerCase() ?? '';
          if (text.startsWith(t.text)) {
            e.preventDefault();
            e.stopPropagation();
            setActive(idx);
            break;
          }
        }
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [actionable, active, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      style={{ minWidth, ...style }}
      className={cx(
        'vx-pop fixed z-[70] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-vx-md border border-vx-hair bg-vx-float p-1.5 shadow-vx-3 outline-none',
        className,
      )}
    >
      {items.map((it) => {
        if (it.type === 'separator') return <div key={it.id} role="separator" className="mx-1.5 my-1.5 h-px bg-vx-hair-soft" />;
        if (it.type === 'label')
          return (
            <div key={it.id} className="vx-meta px-3 pb-1 pt-1.5 text-vx-text-3">
              {it.label}
            </div>
          );
        const idx = actionable.findIndex((a) => a.it === it);
        const isActive = idx === active && idx >= 0;
        const danger = it.danger || it.tone === 'danger';
        return (
          <button
            key={it.id}
            role="menuitem"
            type="button"
            disabled={it.disabled}
            aria-disabled={it.disabled || undefined}
            title={it.disabled ? it.reason : undefined}
            onMouseEnter={() => idx >= 0 && setActive(idx)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cx(
              'flex w-full items-center gap-3 rounded-vx-sm px-3 text-left text-[14px] leading-5 transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-[.38]',
              it.hint ? 'min-h-11 py-1.5' : 'h-9',
              danger ? 'text-vx-del-fg' : 'text-vx-text-1',
              isActive && 'bg-vx-hover',
            )}
          >
            <span
              className={cx(
                'flex w-[18px] shrink-0 items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]',
                it.checked ? 'text-vx-accent' : danger ? 'text-vx-del-fg' : it.tone === 'past' ? 'text-vx-past' : 'text-vx-text-2',
              )}
              aria-hidden
            >
              {it.checked ? <Check size={18} strokeWidth={2} /> : it.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span data-menu-label className="block truncate">
                {it.label}
              </span>
              {it.hint ? <span className="vx-meta block truncate text-vx-text-3">{it.hint}</span> : null}
            </span>
            {it.kbd ? <span className="shrink-0 pl-2 text-[11px] font-medium text-vx-text-4">{it.kbd}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Keep a w × h box inside the viewport with an 8 px margin, flipping above/left when needed. */
export function placeInViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  flipY?: number,
): { left: number; top: number } {
  let top = y;
  if (top + h > vh - 8 && flipY !== undefined && flipY - h >= 8) top = flipY - h;
  const left = Math.max(8, Math.min(x, vw - w - 8));
  top = Math.max(8, Math.min(top, vh - h - 8));
  return { left, top };
}

/**
 * A menu positioned at a point (right-click). Render it while `at` is set.
 * `align: 'end'` treats x as the menu's right edge. `flipY` is where to put the
 * bottom edge if the menu does not fit below.
 */
export function ContextMenu({
  at,
  items,
  onClose,
  align = 'start',
  minWidth,
}: {
  at: { x: number; y: number; flipY?: number } | null;
  items: MenuItem[];
  onClose: () => void;
  align?: 'start' | 'end';
  minWidth?: number;
}) {
  const [pos, setPos] = useState<{ key: string; left: number; top: number } | null>(null);
  if (!at || typeof document === 'undefined') return null;
  const key = `${at.x}:${at.y}`;
  const placed = pos?.key === key ? pos : null;
  return createPortal(
    <MenuList
      key={key}
      items={items}
      onClose={onClose}
      minWidth={minWidth}
      style={placed ? { left: placed.left, top: placed.top } : { left: at.x, top: at.y, opacity: 0, pointerEvents: 'none' }}
      onMeasure={(el) => {
        const r = el.getBoundingClientRect();
        const x = align === 'end' ? at.x - r.width : at.x;
        setPos({ key, ...placeInViewport(x, at.y, r.width, r.height, window.innerWidth, window.innerHeight, at.flipY) });
      }}
    />,
    document.body,
  );
}

/**
 * A dropdown anchored to its trigger. `trigger` receives the toggle props.
 * `placement: 'below'` (default) opens 4 px under the trigger; `'over'` opens on
 * top of the trigger from its top-left corner (the + New menu).
 */
export function Menu({
  trigger,
  items,
  align = 'start',
  placement = 'below',
  minWidth,
}: {
  trigger: (p: { onClick: (e: React.MouseEvent<HTMLElement>) => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => React.ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  placement?: 'below' | 'over';
  minWidth?: number;
}) {
  const [at, setAt] = useState<{ x: number; y: number; flipY?: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  return (
    <>
      {trigger({
        'aria-expanded': !!at,
        'aria-haspopup': 'menu',
        onClick: (e) => {
          if (at) return setAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          const x = align === 'end' ? r.right : r.left;
          setAt(placement === 'over' ? { x, y: r.top } : { x, y: r.bottom + 4, flipY: r.top - 4 });
        },
      })}
      <ContextMenu at={at} items={items} onClose={close} align={align} minWidth={minWidth} />
    </>
  );
}

export default Menu;
