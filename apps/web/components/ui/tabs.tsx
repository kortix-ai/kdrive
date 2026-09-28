'use client';

import { cx } from './cx';

export interface TabItem<T extends string> {
  id: T;
  label: React.ReactNode;
  count?: number;
}

/** Panel / page tabs: mono labels, active underline, optional count suffix. */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex h-9 items-stretch gap-4 border-b border-vx-hair', className)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cx(
            'vx-label -mb-px border-b transition-colors duration-[120ms]',
            t.id === value ? 'border-vx-text-1 text-vx-text-1' : 'border-transparent hover:text-vx-text-2',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 text-vx-text-4">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
