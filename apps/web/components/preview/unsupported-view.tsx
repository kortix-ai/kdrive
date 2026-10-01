'use client';

import { Download } from 'lucide-react';
import { formatBytes, mimeFor } from '@volumes/shared';
import { buttonClass } from '@/components/ui/button';
import { FileIcon } from '@/components/ui/file-icon';

/** Unknown / binary files: a specimen card (64 px type tile, size, type, version hash, Download). */
export function UnsupportedView({
  name,
  size,
  downloadHref,
  version,
  mime,
}: {
  name: string;
  size: number;
  downloadHref: string;
  version?: string | null;
  mime?: string;
}) {
  const type = (mime ?? mimeFor(name)).split(';')[0];
  return (
    <div className="p-3">
      <div className="flex flex-col items-center rounded-vx-md border border-vx-hair bg-vx-surface px-6 py-8 text-center">
        <FileIcon name={name} type="file" size={64} />
        <div className="vx-ui mt-4 max-w-full truncate text-vx-text-1" title={name}>
          {name}
        </div>
        <p className="vx-body mt-1 text-vx-text-3">No preview for this type of file.</p>
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 border-t border-vx-hair-soft pt-4 text-left text-[13px] leading-5">
          <dt className="vx-colhead">Size</dt>
          <dd className="vx-meta-row text-vx-text-1">{formatBytes(size)}</dd>
          <dt className="vx-colhead">Type</dt>
          <dd className="vx-meta-row break-all text-vx-text-1">{type}</dd>
          {version ? (
            <>
              <dt className="vx-colhead">Version</dt>
              <dd className="vx-meta-row text-vx-text-1" title={version}>
                {version.slice(0, 12).toLowerCase()}
              </dd>
            </>
          ) : null}
        </dl>
        <a href={downloadHref} className={buttonClass('outline', 'md', { withIcon: true, className: 'mt-5' })}>
          <Download size={16} strokeWidth={1.75} aria-hidden /> Download
        </a>
      </div>
    </div>
  );
}

export default UnsupportedView;
