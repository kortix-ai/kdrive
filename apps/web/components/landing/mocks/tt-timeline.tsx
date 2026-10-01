'use client';

import { useRef } from 'react';
import type { Version } from './tt-data';

// The stage's timeline (LANDING-SPEC §6.2): a tick per version from the first
// to the head, checkpoint diamonds with labels above, and a draggable handle
// (role="slider") that snaps to versions that have data.
export function Timeline({
  list,
  index,
  onChange,
}: {
  list: Version[];
  index: number;
  onChange: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const first = list[0].v;
  const last = list[list.length - 1].v;
  const pos = (v: number) => ((v - first) / (last - first)) * 100;
  const cur = list[index];

  const nearest = (clientX: number) => {
    const el = track.current;
    if (!el) return index;
    const r = el.getBoundingClientRect();
    const v = first + ((clientX - r.left) / r.width) * (last - first);
    let best = 0;
    for (let i = 1; i < list.length; i++) if (Math.abs(list[i].v - v) < Math.abs(list[best].v - v)) best = i;
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(nearest(e.clientX));
    (e.currentTarget.querySelector('[role="slider"]') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const i = nearest(e.clientX);
    if (i !== index) onChange(i);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      Home: 0,
      End: list.length - 1,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    onChange(Math.max(0, Math.min(list.length - 1, map[e.key])));
  };

  const ticks: number[] = [];
  for (let v = first; v <= last; v++) ticks.push(v);
  const byV = new Map(list.map((x) => [x.v, x]));

  return (
    <div className="kd-tt__timeline">
      <div
        ref={track}
        className="kd-tt__track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        style={{ '--kd-p': `${pos(cur.v)}%` } as React.CSSProperties}
      >
        <span className="kd-tt__line" aria-hidden="true" />
        <span className="kd-tt__fill" aria-hidden="true" />
        {ticks.map((v) => {
          const data = byV.get(v);
          const cls = data?.checkpoint ? 'is-cp' : data?.restoreOf ? 'is-restore' : data ? 'is-data' : '';
          return (
            <span key={v} aria-hidden="true">
              <span className={`kd-tt__tick ${cls}${v <= cur.v ? ' is-before' : ''}`} style={{ left: `${pos(v)}%` }} />
              {data?.checkpoint && (
                <span className="kd-tt__cp" style={{ left: `${pos(v)}%` }}>
                  {data.checkpoint}
                </span>
              )}
            </span>
          );
        })}
        <div
          role="slider"
          tabIndex={0}
          className={`kd-tt__handle${index < list.length - 1 ? ' is-past' : ''}`}
          aria-label="Version"
          aria-valuemin={first}
          aria-valuemax={last}
          aria-valuenow={cur.v}
          aria-valuetext={`v${cur.v} · ${cur.when}`}
          onKeyDown={onKeyDown}
        >
          {index > 0 && index < list.length - 1 && (
            <span className="kd-tt__handle-label" aria-hidden="true">
              v{cur.v}
            </span>
          )}
        </div>
      </div>
      <div className="kd-tt__scale" aria-hidden="true">
        {/* the stage is interactive: say so where the eye lands */}
        <span className="kd-tt__how">
          Drag the timeline<span className="kd-tt__keys"> · ← → to step</span>
        </span>
        <span>{list[list.length - 1].restoreOf ? `v${last} · restore` : 'now'}</span>
      </div>
    </div>
  );
}
