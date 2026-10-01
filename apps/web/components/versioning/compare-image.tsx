'use client';

import { useCallback, useRef, useState } from 'react';
import { formatBytes, type FileSide } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { useHotkeys } from '@/lib/keys';
import { Kbd } from '@/components/ui/kbd';
import { MissingSide, SideDisc, SummaryBar, sideLabel, type CompareSides, type ImageMode } from './compare-header';
import { Bytes } from './readout';
import './versioning.css';

type Dims = { w: number; h: number } | null;
type View = { zoom: number; x: number; y: number };
const FIT: View = { zoom: 1, x: 0, y: 0 };

const dimText = (d: Dims) => (d ? `${d.w}×${d.h}` : '…');

/** Images: side-by-side checkerboard wells (shared zoom/pan) or a swipe with a round Mono A | B handle. */
export function CompareImage({ a, b, mode, sides }: { a: FileSide | null; b: FileSide | null; mode: ImageMode; sides?: CompareSides }) {
  const [da, setDa] = useState<Dims>(null);
  const [db, setDb] = useState<Dims>(null);
  const [failed, setFailed] = useState<{ a?: boolean; b?: boolean }>({});
  const swipe = mode === 'swipe' && !!a && !!b;

  const sizes = a && b ? `${formatBytes(a.size)} → ${formatBytes(b.size)}` : a ? formatBytes(a.size) : b ? formatBytes(b.size) : '';
  const dims = a && b ? (da && db && (da.w !== db.w || da.h !== db.h) ? `${dimText(da)} → ${dimText(db)}` : dimText(db ?? da)) : dimText(da ?? db);
  const same = !!a && !!b && !!a.version && a.version === b.version;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SummaryBar
        right={
          <span className="vx-micro text-vx-text-3 max-[720px]:hidden">
            {swipe ? (
              <>
                Drag or <Kbd>←</Kbd> <Kbd>→</Kbd> · <Kbd>⇧</Kbd> moves 10 · double-click centres
              </>
            ) : (
              <>
                Scroll or <Kbd>+</Kbd> <Kbd>−</Kbd> to zoom · drag to pan · <Kbd>0</Kbd> to fit
              </>
            )}
          </span>
        }
      >
        <span className="truncate font-mono text-[12px] tabular-nums">
          {sizes}
          {dims ? ` · ${dims}` : ''}
          {same ? ' · identical content' : ''}
        </span>
      </SummaryBar>
      {swipe ? (
        <Swipe a={a!} b={b!} sides={sides} onDims={(k, d) => (k === 'a' ? setDa(d) : setDb(d))} />
      ) : (
        <SideBySide a={a} b={b} sides={sides} da={da} db={db} failed={failed} onDims={(k, d) => (k === 'a' ? setDa(d) : setDb(d))} onFail={(k) => setFailed((f) => ({ ...f, [k]: true }))} />
      )}
    </div>
  );
}

function SideBySide({
  a,
  b,
  sides,
  da,
  db,
  failed,
  onDims,
  onFail,
}: {
  a: FileSide | null;
  b: FileSide | null;
  sides?: CompareSides;
  da: Dims;
  db: Dims;
  failed: { a?: boolean; b?: boolean };
  onDims: (k: 'a' | 'b', d: Dims) => void;
  onFail: (k: 'a' | 'b') => void;
}) {
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const zoomBy = useCallback((f: number) => setView((v) => ({ ...v, zoom: Math.max(0.25, Math.min(8, v.zoom * f)) })), []);
  useHotkeys({ plus: () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(0.8), '0': () => setView(FIT) });

  const frame = (k: 'a' | 'b', side: FileSide | null, d: Dims) => (
    <div className="flex min-h-[240px] min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-1 text-[13px] leading-4 text-vx-text-3">
        <SideDisc which={k === 'a' ? 'A' : 'B'} tone={sides?.[k]?.tone} />
        {side ? <span className="truncate font-semibold tabular-nums text-vx-text-1">{sideLabel(side, sides?.[k]?.label)}</span> : null}
      </div>
      {side ? (
        <div
          className="vxv-checker relative min-h-0 flex-1 cursor-grab overflow-hidden rounded-vx-sm border border-vx-hair active:cursor-grabbing"
          onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const s = drag.current;
            if (s) setView((v) => ({ ...v, x: s.vx + (e.clientX - s.x), y: s.vy + (e.clientY - s.y) }));
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={() => setView(FIT)}
        >
          {failed[k] ? (
            <div className="vx-body absolute inset-0 flex items-center justify-center text-vx-text-3">Couldn&apos;t load this image</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={side.contentUrl}
              alt={`Version ${k.toUpperCase()}`}
              draggable={false}
              onLoad={(e) => onDims(k, { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => onFail(k)}
              className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
            />
          )}
        </div>
      ) : (
        <MissingSide which={k === 'a' ? 'A' : 'B'} className="flex-1" />
      )}
      <div className="vx-meta flex h-8 shrink-0 items-center justify-center gap-1.5 text-vx-text-3">
        {side ? (
          <>
            <span className="tabular-nums">{dimText(d)}</span>
            <span aria-hidden>·</span>
            <Bytes n={side.size} />
          </>
        ) : (
          '—'
        )}
      </div>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-auto p-4 max-[720px]:flex-col">
      {frame('a', a, da)}
      {frame('b', b, db)}
    </div>
  );
}

function Swipe({ a, b, sides, onDims }: { a: FileSide; b: FileSide; sides?: CompareSides; onDims: (k: 'a' | 'b', d: Dims) => void }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
  const setFromX = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  const nudge = (d: number) => setPos((p) => Math.max(0, Math.min(100, p + d)));
  // shift variants first: a plain 'arrowleft' spec also matches with Shift held
  useHotkeys({
    'shift+arrowleft': () => nudge(-10),
    'shift+arrowright': () => nudge(10),
    arrowleft: () => nudge(-1),
    arrowright: () => nudge(1),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-1 text-[13px] leading-4 text-vx-text-3">
        <span className="flex min-w-0 items-center gap-2">
          <SideDisc which="A" tone={sides?.a?.tone} />
          <span className="truncate font-semibold tabular-nums text-vx-text-1">{sideLabel(a, sides?.a?.label)}</span>
        </span>
        <span className="font-mono text-[12px] tabular-nums">{Math.round(pos)}%</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold tabular-nums text-vx-text-1">{sideLabel(b, sides?.b?.label)}</span>
          <SideDisc which="B" tone={sides?.b?.tone} />
        </span>
      </div>
      <div
        ref={box}
        className="vxv-checker relative min-h-0 flex-1 cursor-ew-resize select-none overflow-hidden rounded-vx-sm border border-vx-hair"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragging.current = true;
          setActive(true);
          setFromX(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && setFromX(e.clientX)}
        onPointerUp={() => {
          dragging.current = false;
          setActive(false);
        }}
        onDoubleClick={() => setPos(50)}
      >
        {/* B underneath, A on top clipped to the left of the divider */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={b.contentUrl}
          alt="Version B"
          draggable={false}
          onLoad={(e) => onDims('b', { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.contentUrl}
          alt="Version A"
          draggable={false}
          onLoad={(e) => onDims('a', { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-vx-text-1 shadow-[0_0_0_1px_var(--vx-surface)]" style={{ left: `${pos}%` }} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Swipe between A and B"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              nudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
            }
          }}
          className={cx(
            'vxv-handle absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[3px] text-[10px] font-medium leading-none transition-transform duration-[120ms]',
            active && 'scale-110',
          )}
          style={{ left: `${pos}%` }}
        >
          <span aria-hidden className="text-vx-past">A</span>
          <span aria-hidden className="h-3 w-px bg-vx-hair-strong" />
          <span aria-hidden className="text-vx-text-1">B</span>
        </div>
      </div>
    </div>
  );
}

export default CompareImage;
