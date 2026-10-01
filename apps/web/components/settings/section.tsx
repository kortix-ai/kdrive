import { cx } from '@/components/ui/cx';

/**
 * A settings block (UNIFY-SPEC §14.4): settings is one sheet, and each section is a hairline-separated
 * block inside it (padding 24 0, no card per section). Title Inter 16/600 with an optional text-3
 * description and a right-aligned `aside`. `danger` draws the danger zone, the one framed block
 * (1 px danger-edge, r6, danger title).
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
  const body = (
    <>
      <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-3', children ? 'mb-4' : null)}>
        <div className="min-w-0 flex-[1_1_260px]">
          <h2 id={`s-${id}`} className={cx('vx-title', danger && '!text-vx-danger')}>
            {label}
          </h2>
          {description ? <p className="vx-body mt-1 text-vx-text-3">{description}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </>
  );
  return (
    <section aria-labelledby={`s-${id}`} className={cx('scroll-mt-4 py-6', className)}>
      {danger ? <div className="rounded-vx-md border border-vx-danger-edge px-5 py-4 max-[720px]:px-4">{body}</div> : body}
    </section>
  );
}

/** Inline error line inside a settings block. */
export function SectionError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
      {children}
    </p>
  );
}
