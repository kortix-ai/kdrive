'use client';

import { cx } from './cx';

export interface TabItem<T extends string> {
  id: T;
  label: React.ReactNode;
  count?: number;
}

/**
 * Tabs (DESIGN-v2 §5): 44 px, 14/500 text-3; the selected tab is text-1 600 with a 3 px accent
 * bar (rounded top, 8 px inset) sitting on the hair-soft rule; an optional count pill.
 */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex h-11 items-stretch gap-1 border-b border-vx-hair-soft', className)}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = items.findIndex((x) => x.id === t.id);
              const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
              onChange(next.id);
              const el = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[items.indexOf(next)];
              el?.focus();
            }}
            className={cx(
              'relative -mb-px inline-flex items-center gap-1.5 px-3 text-[14px] leading-5 transition-colors duration-[120ms] focus-visible:-outline-offset-2',
              on ? 'font-semibold text-vx-text-1' : 'font-medium text-vx-text-3 hover:text-vx-text-1',
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                className={cx(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                  on ? 'bg-vx-accent-wash text-vx-on-accent-wash' : 'bg-vx-surface-3 text-vx-text-2',
                )}
              >
                {t.count}
              </span>
            ) : null}
            {on ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-[3px] bg-vx-accent" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
