'use client';

import { useState } from 'react';

// The block strip (LANDING-SPEC §6.6): 48 × 1 MiB blocks. A first upload sends
// all of them; after an edit only the 3 changed blocks are sent. It opens on
// the edit: three lit blocks among 45 already stored is the story.
type Mode = 'first' | 'edit';
const CHANGED = new Set([9, 26, 27]);
const CELLS = Array.from({ length: 48 }, (_, i) => i);

export function BlockStripMock() {
  const [mode, setMode] = useState<Mode>('edit');
  // A new key replays the stagger each time the mode changes.
  const [run, setRun] = useState(0);
  const pick = (m: Mode) => {
    setMode(m);
    setRun((r) => r + 1);
  };
  return (
    <div className="kd-mock kd-blk" data-kd-inview="">
      <div className="kd-mock__bar">
        <div className="kd-sh__seg kd-blk__seg" role="radiogroup" aria-label="Upload">
          {(['first', 'edit'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              className="kd-sh__opt"
              onClick={() => pick(m)}
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                e.preventDefault();
                const next = mode === 'first' ? 'edit' : 'first';
                pick(next);
                (e.currentTarget.parentElement?.querySelector(`[data-m="${next}"]`) as HTMLElement | null)?.focus();
              }}
              data-m={m}
            >
              {m === 'first' ? 'First upload' : 'After an edit'}
            </button>
          ))}
        </div>
        <span className="kd-inset__meta">thesis.pdf · 48 MiB</span>
      </div>
      <div key={run} className={`kd-blk__grid is-${mode}`} aria-hidden="true">
        {CELLS.map((i) => {
          const sent = mode === 'first' || CHANGED.has(i);
          const order = mode === 'first' ? i : [...CHANGED].indexOf(i);
          return (
            <span
              key={i}
              className={`kd-blk__cell${sent ? ' is-sent' : ''}`}
              style={sent ? ({ '--kd-d': `${order * (mode === 'first' ? 20 : 60)}ms` } as React.CSSProperties) : undefined}
            />
          );
        })}
      </div>
      <div className="kd-blk__foot">
        <p className="kd-blk__caption kd-mono" aria-live="polite">
          {mode === 'first' ? '48 of 48 blocks sent · 48 MiB' : '3 of 48 blocks sent · 3 MiB'}
        </p>
        <p className="kd-blk__legend">
          <span>
            <i className="is-sent" aria-hidden="true" /> sent
          </span>
          <span>
            <i aria-hidden="true" /> already stored
          </span>
        </p>
      </div>
    </div>
  );
}
