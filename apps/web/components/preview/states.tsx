'use client';

import { Download, RotateCw } from 'lucide-react';
import { formatBytes } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { contentErrorCopy } from './content';

/** Skeleton sized to the renderer: block (media) or lines (text). */
export function PreviewSkeleton({ variant = 'lines', className }: { variant?: 'block' | 'lines'; className?: string }) {
  if (variant === 'block') return <span aria-busy className={cx('skeleton block aspect-[4/3] w-full', className)} />;
  return (
    <div aria-busy className={cx('px-4 py-4', className)}>
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
    <div role="alert" className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="vx-title">{copy.title}</div>
      {copy.body ? <p className="vx-body text-vx-text-3">{copy.body}</p> : null}
      {copy.retry && onRetry ? (
        <Button size="sm" variant="secondary" icon={<RotateCw size={12} />} onClick={onRetry} className="mt-2">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Text-like files over TEXT_PREVIEW_MAX_BYTES. */
export function TooLarge({ size, downloadHref, className }: { size: number; downloadHref: string; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="vx-title">Too large to preview here.</div>
      <p className="vx-meta text-vx-text-3">
        {formatBytes(size)} <span className="vx-unit">· previews show files up to 5 MiB</span>
      </p>
      <a
        href={downloadHref}
        className="mt-2 inline-flex h-8 items-center gap-2 border border-vx-hair px-3 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1"
      >
        <Download size={14} aria-hidden /> Download
      </a>
    </div>
  );
}

/** `SHOWN AS TEXT` chip for active content (HTML, SVG, XML, JS). */
export function ShownAsTextChip() {
  return (
    <span
      title="HTML, SVG, XML and scripts are never rendered here. You are looking at the file's source."
      className="vx-label inline-flex h-5 items-center border border-vx-hair-strong px-1.5 text-[9.5px] text-vx-text-2"
    >
      Shown as text
    </span>
  );
}
