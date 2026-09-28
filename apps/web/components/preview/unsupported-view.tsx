'use client';

import { Download } from 'lucide-react';
import { formatBytes, mimeFor } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';

/** Unknown / binary files: a specimen block (large glyph, size, type, version hash prefix, Download). */
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
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-24 w-24 items-center justify-center border border-vx-hair bg-vx-mat">
        <FileIcon name={name} type="file" size={40} className="text-vx-text-3" />
      </div>
      <div className="vx-name mt-4 max-w-full truncate text-vx-text-1" title={name}>
        {name}
      </div>
      <dl className="vx-meta mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-left">
        <dt className="text-vx-text-4">size</dt>
        <dd className="text-vx-text-2">{formatBytes(size)}</dd>
        <dt className="text-vx-text-4">type</dt>
        <dd className="text-vx-text-2">{type}</dd>
        {version ? (
          <>
            <dt className="text-vx-text-4">version</dt>
            <dd className="text-vx-text-2" title={version}>
              {version.slice(0, 12).toLowerCase()}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="vx-body mt-4 text-vx-text-3">No preview for this type.</p>
      <a
        href={downloadHref}
        className="mt-3 inline-flex h-8 items-center gap-2 border border-vx-hair px-3 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1"
      >
        <Download size={14} aria-hidden /> Download
      </a>
    </div>
  );
}

export default UnsupportedView;
