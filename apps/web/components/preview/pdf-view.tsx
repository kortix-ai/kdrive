'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

/** Browser-native PDF viewer in an iframe (the API serves PDFs inline without the sandbox CSP, same origin). */
export function PdfView({ src, name }: { src: string; name: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="flex min-w-0 flex-col p-3">
      <div className="relative h-[calc(100dvh-400px)] min-h-[320px] overflow-hidden rounded-vx-sm bg-vx-mat shadow-vx-1">
        {!loaded ? <span aria-hidden className="skeleton absolute inset-0 rounded-none" /> : null}
        <iframe
          src={src}
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
          className="inline-flex items-center gap-1.5 rounded-vx-xs text-[13px] font-medium text-vx-accent hover:text-vx-accent-strong hover:underline"
        >
          <ExternalLink size={16} strokeWidth={1.75} aria-hidden /> Open in a new tab
        </a>
      </div>
    </div>
  );
}

export default PdfView;
