'use client';

import { useState } from 'react';
import { PreviewError } from './states';

/** "1:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Native video player. The API answers Range requests (206), so seeking works without downloading the file. */
export function VideoView({ src, name }: { src: string; name: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [meta, setMeta] = useState<{ w: number; h: number; d: number } | null>(null);
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
      <div className="relative flex min-h-[200px] items-center justify-center bg-vx-mat">
        {state === 'loading' ? <span aria-hidden className="skeleton absolute inset-0" /> : null}
        <video
          key={nonce}
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label={name}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setMeta({ w: v.videoWidth, h: v.videoHeight, d: v.duration });
            setState('ok');
          }}
          onError={() => setState('error')}
          className="relative block max-h-[70vh] w-full"
        />
      </div>
      <div className="vx-meta flex h-9 items-center gap-3 border-t border-vx-hair-soft px-3 text-vx-text-3">
        {meta ? (
          <>
            <span>{formatDuration(meta.d)}</span>
            {meta.w ? (
              <span>
                {meta.w} <span className="vx-unit">×</span> {meta.h} <span className="vx-unit">px</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-vx-text-4">loading…</span>
        )}
        <span className="ml-auto text-vx-text-4">seek freely · streamed in ranges</span>
      </div>
    </div>
  );
}

export default VideoView;
