'use client';

import { useState } from 'react';
import { ForkCube } from '../iso-art';

// Duplicate (LANDING-SPEC §6.3d): a fork leaves the timeline at v38; the ghost
// cube turns solid when the copy is made. Local state only.
const TICKS = Array.from({ length: 15 }, (_, i) => 30 + i);
// the timeline runs the inset's full width; the fork leaves it at v38
const X = (v: number) => 16 + ((v - 30) / 14) * 448;
const END = 360;

export function DuplicateMock() {
  const [done, setDone] = useState(false);
  const [name, setName] = useState('Studio · Tue copy');
  return (
    <div className="kd-inset kd-dup">
      <div className="kd-dup__art">
        <svg viewBox="0 0 480 100" preserveAspectRatio="none" className="kd-dup__svg" aria-hidden="true">
          <line x1="16" y1="30" x2="464" y2="30" className="kd-dup__rail" vectorEffect="non-scaling-stroke" />
          {TICKS.map((v) => (
            <line
              key={v}
              x1={X(v)}
              x2={X(v)}
              y1={v === 38 ? 22 : 26}
              y2={v === 38 ? 38 : 34}
              className={v === 38 ? 'kd-dup__pick' : 'kd-dup__tick'}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={`M${X(38)} 30 C ${X(38)} 62, ${X(38) + 14} 76, ${X(38) + 40} 76 L ${END - 30} 76`}
            className={`kd-dup__branch${done ? ' is-done' : ''}`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {[30, 38, 44].map((v) => (
          <span key={v} className={`kd-dup__t${v === 38 ? ' is-hi' : ''}`} style={{ left: `${(X(v) / 480) * 100}%` }} aria-hidden="true">
            v{v}
          </span>
        ))}
        <span className={`kd-dup__cube${done ? ' is-done' : ''}`} style={{ left: `${(END / 480) * 100}%` }}>
          <ForkCube solid={false} className="kd-dup__ghost" />
          <ForkCube solid className="kd-dup__solid" />
        </span>
        <span className="kd-dup__label" style={{ left: `${(END / 480) * 100}%` }} aria-live="polite">
          {done ? 'Ready · 0 bytes copied' : name || 'Untitled copy'}
        </span>
      </div>
      <div className="kd-dup__form">
        <p className="kd-dup__what">
          Duplicate Studio at <span className="kd-mono">v38 · Tue 14:08</span>
        </p>
        <div className="kd-dup__row">
          <label className="kd-sr-only" htmlFor="kd-dup-name">
            Name of the copy
          </label>
          <input id="kd-dup-name" className="kd-field" value={name} onChange={(e) => setName(e.target.value)} disabled={done} />
          {done ? (
            <button type="button" className="kd-mbtn" onClick={() => setDone(false)}>
              Reset
            </button>
          ) : (
            <button type="button" className="kd-mbtn kd-mbtn--primary" onClick={() => setDone(true)}>
              Duplicate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
