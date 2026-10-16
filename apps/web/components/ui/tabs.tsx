'use client';

import { cx } from './cx';

export interface TabItem<T extends string> {
  id: T;
  label: React.ReactNode;
  count?: number;
}

/**
 * Tabs: 40 px, 14.5/500 text-3; the selected tab is text-1 with a 2 px ink bar flush on the 1 px hair rule;
 * an optional Mono 11 count.
 */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex h-10 items-stretch gap-1 border-b border-vx-hair', className)}>
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
              'relative -mb-px inline-flex items-center gap-1.5 whitespace-nowrap px-3 text-[14.5px] leading-5 transition-colors duration-[160ms] focus-visible:-outline-offset-2',
              on ? 'font-medium text-vx-text-1' : 'font-medium text-vx-text-3 hover:text-vx-text-1',
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-vx-surface-3 px-1 font-mono text-[11px] tabular-nums text-vx-text-2">
                {t.count}
              </span>
            ) : null}
            {on ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-vx-text-1" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
