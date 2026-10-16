'use client';

import { useState } from 'react';
import { FileIcon } from '@/components/ui/file-icon';
import { PreviewError } from './states';
import { formatDuration } from './video-view';

/** Native audio player over a specimen block (Range requests make seeking work). */
export function AudioView({ src, name, viewOnly }: { src: string; name: string; /** hides the player's own Download */ viewOnly?: boolean }) {
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
    <div className="flex min-w-0 flex-col p-3">
      <div className="flex flex-col items-center rounded-vx-md border border-vx-hair bg-vx-surface px-6 pb-6 pt-8">
        <FileIcon name={name} type="file" size={48} />
        <div className="vx-ui mt-3 max-w-full truncate text-vx-text-1" title={name}>
          {name}
        </div>
        <div className="vx-meta mt-1 text-vx-text-3">{duration !== null ? formatDuration(duration) : state === 'loading' ? 'Loading…' : '—'}</div>
        <audio
          key={nonce}
          src={src}
          controls
          controlsList={viewOnly ? 'nodownload' : undefined}
          preload="metadata"
          aria-label={name}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            setState('ok');
          }}
          onError={() => setState('error')}
          className="mt-5 block w-full rounded-vx-sm"
        />
      </div>
    </div>
  );
}

export default AudioView;
