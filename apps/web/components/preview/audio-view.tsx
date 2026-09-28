'use client';

import { useState } from 'react';
import { FileMusic } from 'lucide-react';
import { PreviewError } from './states';
import { formatDuration } from './video-view';

/** Native audio player over a specimen block (Range requests make seeking work). */
export function AudioView({ src, name }: { src: string; name: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [duration, setDuration] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  if (state === 'error') {
    return (
      <PreviewError
        status={500}
        onRetry={() => {
          setState('loading');
          setNonce((n) => n + 1);
        }}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-col items-center gap-3 bg-vx-mat px-6 py-10">
        <FileMusic size={40} strokeWidth={1.25} className="text-vx-text-3" aria-hidden />
        <div className="vx-name max-w-full truncate text-vx-text-1" title={name}>
          {name}
        </div>
        <div className="vx-meta text-vx-text-3">{duration !== null ? formatDuration(duration) : state === 'loading' ? '…' : '—'}</div>
      </div>
      <div className="border-t border-vx-hair-soft px-3 py-3">
        <audio
          key={nonce}
          src={src}
          controls
          preload="metadata"
          aria-label={name}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            setState('ok');
          }}
          onError={() => setState('error')}
          className="block w-full"
        />
      </div>
    </div>
  );
}

export default AudioView;
