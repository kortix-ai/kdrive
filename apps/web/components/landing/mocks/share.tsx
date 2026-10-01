'use client';

import { useState } from 'react';
import { CopyButton, FileIcon } from './bits';

// Share (LANDING-SPEC §6.3c): live or pinned links, copy, and the same expiry
// choices as the app's share dialog (components/share/expiry.ts).
type Mode = 'live' | 'pinned';
const EXPIRY = [
  { id: 'never', label: 'Never' },
  { id: '1d', label: '1 day' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom date' },
];
const LINK = { live: 'k7Qm2xR9', pinned: 'p4Vt8cL2' };

export function ShareMock() {
  const [mode, setMode] = useState<Mode>('live');
  return (
    <div className="kd-inset kd-sh">
      <p className="kd-sh__file">
        <FileIcon />
        <span className="kd-sh__name">launch.pdf</span>
        <span className="kd-mono kd-sh__size">3.9 MB · v44</span>
      </p>
      <div className="kd-sh__seg" role="radiogroup" aria-label="Link type">
        {(['live', 'pinned'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            tabIndex={mode === m ? 0 : -1}
            onClick={() => setMode(m)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                const next = mode === 'live' ? 'pinned' : 'live';
                setMode(next);
                (e.currentTarget.parentElement?.querySelector(`[data-m="${next}"]`) as HTMLElement | null)?.focus();
              }
            }}
            data-m={m}
            className="kd-sh__opt"
          >
            {m === 'live' ? (
              'Live'
            ) : (
              <>
                Pinned to <span className="kd-mono">v44</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div className="kd-sh__field">
        <span className="kd-sh__link kd-mono" title={`/s/${LINK[mode]}`}>
          …/s/{LINK[mode]}
        </span>
        <CopyButton text={`/s/${LINK[mode]}`} />
      </div>
      <label className="kd-sh__expiry">
        <span>Expires</span>
        <select defaultValue="never" className="kd-sh__select">
          {EXPIRY.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="kd-sh__help" aria-live="polite">
        {mode === 'live' ? 'Shows launch.pdf as it is now, every time.' : 'Always shows launch.pdf as it was at v44.'}
      </p>
    </div>
  );
}
