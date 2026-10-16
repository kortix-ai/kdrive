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
export function VideoView({ src, name, viewOnly }: { src: string; name: string; /** hides the player's own Download */ viewOnly?: boolean }) {
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
    <div className="flex min-w-0 flex-col p-3">
      <div className="relative flex min-h-[200px] items-center justify-center overflow-hidden rounded-vx-sm border border-vx-hair bg-vx-mat">
        {state === 'loading' ? <span aria-hidden className="skeleton absolute inset-0 rounded-none" /> : null}
        <video
          key={nonce}
          src={src}
          controls
          controlsList={viewOnly ? 'nodownload' : undefined}
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
      <div className="vx-meta flex min-h-9 flex-wrap items-end gap-x-3 gap-y-1 pt-2 text-vx-text-3">
        {meta ? (
          <>
            <span>{formatDuration(meta.d)}</span>
            {meta.w ? <span>{`${meta.w} × ${meta.h} px`}</span> : null}
          </>
        ) : (
          <span>Loading…</span>
        )}
        <span className="vx-micro ml-auto font-sans text-vx-text-3">Seek freely. It streams as you go.</span>
      </div>
    </div>
  );
}

export default VideoView;
