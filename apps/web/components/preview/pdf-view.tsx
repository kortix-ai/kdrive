'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

/** Browser-native PDF viewer in an iframe (served inline, same origin), with the browser's own toolbar hidden: download and open live in the panel. */
export function PdfView({ src, name }: { src: string; name: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="flex min-w-0 flex-col p-3">
      <div className="relative h-[calc(100dvh-400px)] min-h-[320px] overflow-hidden rounded-vx-sm border border-vx-hair bg-vx-mat">
        {!loaded ? <span aria-hidden className="skeleton absolute inset-0 rounded-none" /> : null}
        <iframe
          src={`${src}#toolbar=0&navpanes=0&view=FitH`}
          title={`PDF: ${name}`}
          onLoad={() => setLoaded(true)}
          referrerPolicy="same-origin"
          className="relative h-full w-full border-0"
        />
      </div>
      <div className="flex h-9 items-end justify-end">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-vx-xs text-[13px] font-medium text-vx-text-1 underline-offset-[3px] hover:underline"
        >
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden /> Open in a new tab
        </a>
      </div>
    </div>
  );
}

export default PdfView;
