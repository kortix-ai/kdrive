'use client';

import { useState } from 'react';
import { FileIcon } from './bits';

// The review inbox (LANDING-SPEC §6.4): an agent's proposal waits until you
// accept or discard it, file by file. Local state only. One filled button
// (accept all); only the expanded row carries buttons, the others a quiet
// mono text pair.
type State = 'pending' | 'accepted' | 'discarded';

const ROWS = [
  { id: 'sources', path: 'notes/sources.md', chip: 'changed', count: ['+12', '−3'] },
  { id: 'ch3', path: 'drafts/ch3.md → archive/ch3.md', chip: 'moved' },
  { id: 'fig', path: 'figures/fig-2.svg', chip: 'added' },
] as const;

const DIFF = [
  { kind: 'del', text: 'Smith 2019, p. 4' },
  { kind: 'add', text: 'Smith 2019, pp. 4–6' },
  { kind: 'add', text: 'Okafor 2021, ch. 2' },
] as const;

const LOG = [
  { verb: 'read', what: 'notes/sources.md, drafts/ch3.md' },
  { verb: 'compared', what: 'v29 → v31' },
  { verb: 'proposed', what: '3 changes (checked against v31)' },
];

const ALL_PENDING: Record<string, State> = { sources: 'pending', ch3: 'pending', fig: 'pending' };

export function ProposalInboxMock() {
  const [state, setState] = useState<Record<string, State>>(ALL_PENDING);
  const set = (id: string, s: State) => setState((prev) => ({ ...prev, [id]: s }));
  const pending = ROWS.filter((r) => state[r.id] === 'pending');
  const accepted = ROWS.filter((r) => state[r.id] === 'accepted').length;
  const setAll = (s: State) => setState(Object.fromEntries(ROWS.map((r) => [r.id, state[r.id] === 'pending' ? s : state[r.id]])));

  return (
    <div className="kd-mock kd-inbox">
      <div className="kd-inbox__head">
        <p>
          <b>research-agent</b> proposed 3 changes
          <span className="kd-inbox__when">
            <span className="kd-inbox__sep"> · </span>
            <span className="kd-mono">4&nbsp;min&nbsp;ago</span>
          </span>
        </p>
        <p className="kd-inbox__check">
          <span aria-hidden="true">✓</span> Checked against your changes since <span className="kd-mono">v31</span>: no&nbsp;conflicts
        </p>
      </div>
      <ul className="kd-inbox__rows">
        {ROWS.map((r) => {
          const s = state[r.id];
          return (
            <li key={r.id} className={`kd-inbox__row is-${s}`}>
              <div className="kd-inbox__line">
                <FileIcon />
                <span className="kd-inbox__path" title={r.path}>
                  {r.path}
                </span>
                <span className="kd-chip">{r.chip}</span>
                {'count' in r && (
                  <span className="kd-inbox__count kd-mono">
                    <span className="is-add">{r.count[0]}</span> <span className="is-del">{r.count[1]}</span>
                  </span>
                )}
                <span className="kd-inbox__act" aria-live="polite">
                  {s === 'pending' && r.id === 'sources' ? (
                    <>
                      <button type="button" className="kd-mbtn" onClick={() => set(r.id, 'discarded')} aria-label={`Discard ${r.path}`}>
                        Discard
                      </button>
                      <button type="button" className="kd-mbtn" onClick={() => set(r.id, 'accepted')} aria-label={`Accept ${r.path}`}>
                        Accept
                      </button>
                    </>
                  ) : s === 'pending' ? (
                    <span className="kd-inbox__pair">
                      <button type="button" className="kd-textbtn" onClick={() => set(r.id, 'accepted')} aria-label={`Accept ${r.path}`}>
                        accept
                      </button>
                      <span aria-hidden="true">·</span>
                      <button type="button" className="kd-textbtn" onClick={() => set(r.id, 'discarded')} aria-label={`Discard ${r.path}`}>
                        discard
                      </button>
                    </span>
                  ) : (
                    <span className="kd-inbox__state">{s === 'accepted' ? '✓ Accepted' : 'Discarded'}</span>
                  )}
                </span>
              </div>
              {r.id === 'sources' && s === 'pending' && (
                <div className="kd-diff kd-inbox__diff" aria-label="Changes to notes/sources.md">
                  {DIFF.map((d) => (
                    <div key={d.text} className={`kd-diff__row is-${d.kind}`}>
                      <span className="kd-diff__gutter" aria-hidden="true">
                        {d.kind === 'add' ? '+' : '−'}
                      </span>
                      <span className="kd-diff__text">
                        <span className="kd-sr-only">{d.kind === 'add' ? 'Added: ' : 'Removed: '}</span>
                        {d.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="kd-inbox__foot" aria-live="polite">
        {pending.length ? (
          <span className="kd-inbox__all">
            <button type="button" className="kd-textbtn" onClick={() => setAll('discarded')}>
              Discard all
            </button>
            <button type="button" className="kd-mbtn kd-mbtn--primary" onClick={() => setAll('accepted')}>
              Accept {pending.length}
            </button>
          </span>
        ) : (
          <span className="kd-inbox__done">
            {accepted ? (
              <>
                Accepted as <span className="kd-mono">v32</span>
              </>
            ) : (
              'All discarded'
            )}
            <span aria-hidden="true"> · </span>
            <button type="button" className="kd-linkbtn" onClick={() => setState(ALL_PENDING)}>
              Undo
            </button>
          </span>
        )}
        <span className="kd-inbox__expire kd-mono">Proposals expire after 30 days.</span>
      </div>
      <details className="kd-inbox__log">
        <summary>What the agent did</summary>
        <dl>
          {LOG.map((l) => (
            <div key={l.verb}>
              <dt>{l.verb}</dt>
              <dd>{l.what}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
