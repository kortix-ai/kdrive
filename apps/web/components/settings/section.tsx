import { cx } from '@/components/ui/cx';

/**
 * A settings card (DESIGN-v2 §6.17): surface, 1 px hair, shadow-sheet, r16, padding 20 24;
 * a 16/600 title with an optional text-3 description and a right-aligned `aside`.
 * `danger` draws the danger-zone card (danger-edge border, del-fg title).
 */
export function Section({
  id,
  label,
  description,
  aside,
  children,
  className,
  danger,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  danger?: boolean;
}) {
  return (
    <section
      aria-labelledby={`s-${id}`}
      className={cx(
        'rounded-vx-lg border bg-vx-surface px-6 py-5 shadow-vx-sheet max-[720px]:px-4 max-[720px]:py-4',
        danger ? 'border-vx-danger-edge' : 'border-vx-hair',
        className,
      )}
    >
      <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-3', children ? 'mb-4' : null)}>
        <div className="min-w-0 flex-[1_1_260px]">
          <h2 id={`s-${id}`} className={cx('text-[16px] font-semibold leading-6 tracking-[-0.01em]', danger ? 'text-vx-del-fg' : 'text-vx-text-1')}>
            {label}
          </h2>
          {description ? <p className="vx-body mt-0.5 text-vx-text-3">{description}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Inline error line inside a settings card. */
export function SectionError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-del-fg">
      {children}
    </p>
  );
}
