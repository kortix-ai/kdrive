'use client';

import { useCallback, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { useHotkeys } from '@/lib/keys';
import { PreviewError } from './states';

/** 8 px checkerboard behind images (`--vx-surface-2` / `--vx-surface-3`). */
export const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: 'var(--vx-surface-2)',
  backgroundImage:
    'conic-gradient(var(--vx-surface-3) 25%, transparent 0 50%, var(--vx-surface-3) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
};

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8];

/** Next zoom step above / below `current` (a scale factor). */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_STEPS[0];
}

/** Image preview: fit by default; `+` / `-` zoom, `0` fit, `1` 100 %. */
export function ImageView({ src, name, keys = true }: { src: string; name: string; keys?: boolean }) {
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);
  const img = useRef<HTMLImageElement>(null);

  const currentScale = useCallback((): number => {
    if (zoom !== 'fit') return zoom;
    const el = img.current;
    if (!el || !el.naturalWidth) return 1;
    return el.clientWidth / el.naturalWidth;
  }, [zoom]);

  const zoomIn = () => setZoom(stepZoom(currentScale(), 1));
  const zoomOut = () => setZoom(stepZoom(currentScale(), -1));

  useHotkeys(
    {
      plus: zoomIn,
      '=': zoomIn,
      '-': zoomOut,
      '0': () => setZoom('fit'),
      '1': () => setZoom(1),
    },
    { enabled: keys && state === 'ok' },
  );

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

  const fit = zoom === 'fit';
  const ctl = 'disabled:opacity-[.38]';
  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative max-h-[70vh] min-h-[160px] overflow-auto" style={CHECKERBOARD}>
        {state === 'loading' ? <span aria-hidden className="skeleton absolute inset-0 rounded-none" /> : null}
        <div className={fit ? 'flex min-h-[160px] items-center justify-center p-4' : 'inline-block p-4'}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={nonce}
            ref={img}
            src={src}
            alt={name}
            decoding="async"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              setDims({ w: el.naturalWidth, h: el.naturalHeight });
              setState('ok');
            }}
            onError={() => setState('error')}
            className="block rounded-vx-xs shadow-vx-1"
            style={
              fit
                ? { maxWidth: '100%', maxHeight: 'calc(70vh - 32px)', objectFit: 'contain', opacity: state === 'ok' ? 1 : 0 }
                : { width: dims ? dims.w * zoom : undefined, maxWidth: 'none', imageRendering: zoom >= 2 ? 'pixelated' : undefined }
            }
          />
        </div>
      </div>
      <div className="flex h-11 items-center gap-1 px-2">
        <span className="vx-meta min-w-0 flex-1 truncate pl-1 text-vx-text-3">
          {dims ? `${dims.w} × ${dims.h} px` : '—'}
        </span>
        <span className="vx-meta w-12 text-right text-vx-text-2" aria-live="polite">
          {fit ? 'Fit' : `${Math.round((zoom as number) * 100)}%`}
        </span>
        <IconButton label="Zoom out (-)" size="sm" className={ctl} onClick={zoomOut} disabled={state !== 'ok'}>
          <Minus size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton label="Zoom in (+)" size="sm" className={ctl} onClick={zoomIn} disabled={state !== 'ok'}>
          <Plus size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton label="Fit (0)" size="sm" className={ctl} toggled={fit} onClick={() => setZoom('fit')} disabled={state !== 'ok'}>
          <Maximize size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
        <button
          type="button"
          onClick={() => setZoom(1)}
          disabled={state !== 'ok'}
          aria-pressed={zoom === 1}
          title="Actual size (1)"
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors duration-[120ms] disabled:opacity-[.38]',
            zoom === 1 ? 'bg-vx-accent-wash text-vx-on-accent-wash' : 'text-vx-text-2 hover:bg-vx-surface-3 hover:text-vx-text-1',
          )}
        >
          1:1 <Kbd>1</Kbd>
        </button>
      </div>
    </div>
  );
}

export default ImageView;
