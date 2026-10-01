'use client';

import { CircleAlert, Download, RotateCw } from 'lucide-react';
import { TEXT_PREVIEW_MAX_BYTES, formatBytes } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { contentErrorCopy } from './content';

/** Skeleton sized to the renderer: block (media) or lines (text). */
export function PreviewSkeleton({ variant = 'lines', className }: { variant?: 'block' | 'lines'; className?: string }) {
  if (variant === 'block') return <span aria-busy className={cx('skeleton m-3 block aspect-[4/3] rounded-vx-sm', className)} />;
  return (
    <div aria-busy className={cx('px-5 py-5', className)}>
      {[72, 88, 64, 80, 40, 76, 56].map((w, i) => (
        <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** "Couldn't load this file · Retry" (or the specific reason). */
export function PreviewError({
  status,
  code,
  onRetry,
  className,
}: {
  status: number;
  code?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const copy = contentErrorCopy(status, code);
  return (
    <div role="alert" className={cx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span aria-hidden className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-3 text-vx-text-3">
        <CircleAlert size={18} strokeWidth={1.75} />
      </span>
      <div className="vx-title">{copy.title}</div>
      {copy.body ? <p className="vx-body mt-1 max-w-[320px] text-vx-text-3">{copy.body}</p> : null}
      {copy.retry && onRetry ? (
        <Button size="sm" variant="outline" icon={<RotateCw size={16} strokeWidth={1.75} aria-hidden />} onClick={onRetry} className="mt-4">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Text-like files over TEXT_PREVIEW_MAX_BYTES. */
export function TooLarge({ size, downloadHref, className }: { size: number; downloadHref: string; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="vx-title">Too large to preview here</div>
      <p className="vx-meta mt-1.5 text-vx-text-3">
        {formatBytes(size)} · previews show files up to {formatBytes(TEXT_PREVIEW_MAX_BYTES)}
      </p>
      <a href={downloadHref} className={buttonClass('outline', 'sm', { withIcon: true, className: 'mt-4' })}>
        <Download size={16} strokeWidth={1.75} aria-hidden /> Download
      </a>
    </div>
  );
}

/** `Shown as text` badge for active content (HTML, SVG, XML, JS). */
export function ShownAsTextChip() {
  return (
    <Badge tone="dashed" title="HTML, SVG, XML and scripts are never rendered here. You are looking at the file's source.">
      Shown as text
    </Badge>
  );
}
