'use client';

import { useState } from 'react';
import { FileIcon } from './bits';

// Restore (LANDING-SPEC §6.3b): restore a file to an earlier version and undo
// it; below, recently deleted items that come back with one click.
const DELETED = [
  { id: 'mood', name: 'moodboard/', meta: '12 items · deleted Wed', left: '6\u00a0days\u00a0left', dir: true },
  { id: 'logo', name: 'old-logo.svg', meta: 'deleted Mon', left: '4\u00a0days\u00a0left', dir: false },
];

export function RestoreMock() {
  const [restored, setRestored] = useState(false);
  const [back, setBack] = useState<Record<string, boolean>>({});
  return (
    <div className="kd-inset kd-rs">
      <p className="kd-rs__label is-first">File history · proposal.md</p>
      <div className="kd-rs__row" aria-live="polite">
        {restored ? (
          <>
            <span className="kd-rs__done">
              <span className="kd-rs__ok" aria-hidden="true">
                ✓
              </span>
              Restored proposal.md to <span className="kd-mono">v14</span>
            </span>
            <button type="button" className="kd-mbtn" onClick={() => setRestored(false)}>
              Undo restore
            </button>
          </>
        ) : (
          <>
            <span className="kd-rs__file">
              <FileIcon />
              <span className="kd-rs__name">proposal.md</span>
              <span className="kd-rs__meta kd-mono">v19 · now</span>
            </span>
            <button type="button" className="kd-mbtn kd-mbtn--primary" onClick={() => setRestored(true)}>
              Restore to v14
            </button>
          </>
        )}
      </div>
      <p className="kd-rs__label">Recently deleted · kept 7 days</p>
      <ul className="kd-rs__list">
        {DELETED.map((d) => (
          <li key={d.id} className="kd-rs__row" aria-live="polite">
            {back[d.id] ? (
              <span className="kd-rs__done">
                <span className="kd-rs__ok" aria-hidden="true">
                  ✓
                </span>
                Restored to <span className="kd-mono">Studio/</span>
              </span>
            ) : (
              <>
                <span className="kd-rs__file">
                  <FileIcon dir={d.dir} ghost />
                  <span className="kd-rs__name">{d.name}</span>
                  <span className="kd-rs__meta kd-mono">
                    {d.meta}
                    <span className="kd-rs__left">
                      <span className="kd-rs__sep"> · </span>
                      {d.left}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  className="kd-textbtn kd-rs__link"
                  onClick={() => setBack((b) => ({ ...b, [d.id]: true }))}
                  aria-label={`Restore ${d.name}`}
                >
                  Restore
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
