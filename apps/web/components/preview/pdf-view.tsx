'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

/** Browser-native PDF viewer in an iframe (the API serves PDFs inline without the sandbox CSP, same origin). */
export function PdfView({ src, name }: { src: string; name: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative h-[70vh] min-h-[360px] bg-vx-mat">
        {!loaded ? <span aria-hidden className="skeleton absolute inset-0" /> : null}
        <iframe
          src={src}
          title={`PDF: ${name}`}
          onLoad={() => setLoaded(true)}
          referrerPolicy="same-origin"
          className="relative h-full w-full border-0"
        />
      </div>
      <div className="flex h-9 items-center justify-end border-t border-vx-hair-soft px-3">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-vx-text-3 hover:text-vx-text-1"
        >
          <ExternalLink size={12} aria-hidden /> Open in a new tab
        </a>
      </div>
    </div>
  );
}

export default PdfView;
