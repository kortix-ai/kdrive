'use client';

// Small pieces every admin tab uses: the load error with Retry, the skeleton lines, a stat tile and the pager.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-2 rounded-vx-sm bg-vx-danger-wash px-4 py-3">
      <span className="text-[13px] text-vx-danger">Couldn&apos;t load {what}.</span>
      <Button size="sm" variant="text" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function Loading({ lines = [90, 80, 85, 70] }: { lines?: number[] }) {
  return (
    <div className="px-1 py-3" aria-busy>
      {lines.map((w, i) => (
        <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** One number on the overview: a Mono label, the value, and a quiet line under it. Clickable when `onClick` is set. */
export function StatTile({
  label,
  value,
  sub,
  onClick,
  children,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <span className="vx-colhead block">{label}</span>
      <span className="mt-2 block text-[24px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-vx-text-1">{value}</span>
      {sub ? <span className="vx-meta mt-1 block text-vx-text-3">{sub}</span> : null}
      {children}
    </>
  );
  const frame = cx('flex min-w-0 flex-col bg-vx-bg-2 px-4 py-3.5 text-left', className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(frame, 'transition-colors duration-[120ms] hover:bg-vx-raise')}>
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/** "51–100 of 230" with previous / next. Hidden when everything fits on one page. */
export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  if (total <= limit) return null;
  const last = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="mt-3 flex items-center justify-end gap-1">
      <span className="vx-meta mr-2 text-vx-text-3">
        {from}–{to} of {total}
      </span>
      <IconButton size="sm" label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="Next page" disabled={page >= last} onClick={() => onPage(page + 1)}>
        <ChevronRight size={16} strokeWidth={1.75} />
      </IconButton>
    </div>
  );
}
