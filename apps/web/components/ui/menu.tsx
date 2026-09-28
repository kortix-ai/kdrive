'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { Kbd } from './kbd';

export type MenuItem =
  | { type?: 'item'; id: string; label: React.ReactNode; icon?: React.ReactNode; kbd?: string; onSelect: () => void; danger?: boolean; disabled?: boolean; reason?: string; checked?: boolean }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: React.ReactNode };

interface MenuListProps {
  items: MenuItem[];
  onClose: () => void;
  style?: React.CSSProperties;
  className?: string;
}

/** The floating list: keyboard navigable (↑ ↓ ↵ Esc), min 220 px, 28 px items. */
function MenuList({ items, onClose, style, className }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items.map((it, i) => ({ it, i })).filter(({ it }) => (it.type ?? 'item') === 'item' && !(it as { disabled?: boolean }).disabled);
  const [active, setActive] = useState(0);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % Math.max(1, actionable.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + actionable.length) % Math.max(1, actionable.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = actionable[active]?.it as Extract<MenuItem, { onSelect: () => void }> | undefined;
        if (target) {
          onClose();
          target.onSelect();
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
      style={style}
      className={cx('dlg-pop fixed z-[60] min-w-[220px] border border-vx-hair-strong bg-vx-float py-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)] outline-none', className)}
    >
      {items.map((it) => {
        if (it.type === 'separator') return <div key={it.id} className="my-1 h-px bg-vx-hair" />;
        if (it.type === 'label') return <div key={it.id} className="vx-label px-3 py-1.5">{it.label}</div>;
        const idx = actionable.findIndex((a) => a.it === it);
        const isActive = idx === active && idx >= 0;
        return (
          <button
            key={it.id}
            role="menuitem"
            type="button"
            disabled={it.disabled}
            title={it.disabled ? it.reason : undefined}
            onMouseEnter={() => idx >= 0 && setActive(idx)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cx(
              'flex h-7 w-full items-center gap-2.5 px-3 text-left font-mono text-[12px] disabled:opacity-40',
              it.danger ? 'text-vx-danger' : 'text-vx-text-2',
              isActive && (it.danger ? 'bg-vx-danger-wash' : 'bg-vx-surface-2 text-vx-text-1'),
            )}
          >
            <span className="flex w-4 justify-center text-vx-text-3">{it.checked ? '✓' : it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.kbd ? <Kbd className={isActive ? 'text-vx-accent' : undefined}>{it.kbd}</Kbd> : null}
          </button>
        );
      })}
    </div>
  );
}

function clampToViewport(x: number, y: number, el: HTMLElement | null): { left: number; top: number } {
  if (!el || typeof window === 'undefined') return { left: x, top: y };
  const r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
  return { left, top };
}

/** A menu positioned at the pointer (right-click). Render it while `at` is set. */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!at) return;
    setPos(clampToViewport(at.x, at.y, holder.current?.firstElementChild as HTMLElement | null));
  }, [at]);
  if (!at || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={holder}>
      <MenuList items={items} onClose={onClose} style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y }} />
    </div>,
    document.body,
  );
}

/** A dropdown anchored under its trigger. `trigger` receives the toggle props. */
export function Menu({
  trigger,
  items,
  align = 'start',
}: {
  trigger: (p: { onClick: (e: React.MouseEvent<HTMLElement>) => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => React.ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  return (
    <>
      {trigger({
        'aria-expanded': !!at,
        'aria-haspopup': 'menu',
        onClick: (e) => {
          if (at) return setAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: align === 'end' ? r.right - 220 : r.left, y: r.bottom + 4 });
        },
      })}
      <ContextMenu at={at} items={items} onClose={close} />
    </>
  );
}

export default Menu;
