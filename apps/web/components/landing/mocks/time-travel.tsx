'use client';

import { useEffect, useRef, useState } from 'react';
import { FileIcon } from './bits';
import { restoreVersion, rowsAt, type Version, VERSIONS } from './tt-data';
import { Timeline } from './tt-timeline';

// The time-travel stage (LANDING-SPEC §6.2): the whole drive as it was at any
// version, with "not yet" rows, change chips, checkpoints, restore and undo.
// Local state only; no API calls.
const RAIL = ['Studio', 'Thesis', 'Photos', 'Research'];
const START = 3; // v38

export function TimeTravelMock() {
  const [list, setList] = useState<Version[]>(VERSIONS);
  const [index, setIndex] = useState(START);
  const [toast, setToast] = useState<{ of: number; prevIndex: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const cur = list[index];
  const headIndex = list.length - 1;
  const atHead = index === headIndex;
  const rows = rowsAt(list, index);

  const restore = () => {
    const next = [...list, restoreVersion(cur, list[headIndex])];
    setList(next);
    setIndex(next.length - 1);
    setToast({ of: cur.v, prevIndex: index });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 8000);
  };
  const undo = () => {
    if (!toast) return;
    setList((l) => l.slice(0, -1));
    setIndex(toast.prevIndex);
    setToast(null);
  };

  return (
    <div className="kd-mock kd-tt">
      <div className="kd-mock__bar">
        <span className="kd-mock__crumb" title="Studio">
          Studio
        </span>
        <span className="kd-chip kd-tt__date">{cur.when}</span>
      </div>
      <div className="kd-tt__body">
        <aside className="kd-tt__rail" aria-label="Drives">
          <p className="kd-tt__rail-label">Drives</p>
          {RAIL.map((d) => (
            <span key={d} className={`kd-tt__drive${d === 'Studio' ? ' is-active' : ''}`}>
              <i aria-hidden="true" />
              {d}
            </span>
          ))}
          <hr />
          <span className="kd-tt__drive is-muted">Recently deleted</span>
          <span className="kd-tt__drive is-muted">
            Proposals <b className="kd-tt__badge">2</b>
          </span>
        </aside>
        <div className="kd-tt__main">
          {atHead ? (
            <div className="kd-tt__banner is-now">
              <span>
                You're looking at <b>Studio</b> now · <span className="kd-mono">v{cur.v}</span>
              </span>
              <span className={`kd-tt__toast${toast ? ' is-on' : ''}`} role="status">
                {toast && (
                  <>
                    <span>
                      Restored Studio to <span className="kd-mono">v{toast.of}</span>
                    </span>
                    <button type="button" className="kd-linkbtn" onClick={undo}>
                      Undo
                    </button>
                  </>
                )}
              </span>
            </div>
          ) : (
            <div className="kd-tt__banner" aria-live="polite">
              <span className="kd-tt__banner-text">
                Viewing <b>Studio</b> as it was · <span className="kd-mono">{cur.when} · v{cur.v}</span>
              </span>
              <span className="kd-tt__banner-actions">
                <button type="button" className="kd-mbtn kd-mbtn--primary" onClick={restore}>
                  Restore this version
                </button>
                <button type="button" className="kd-mbtn" onClick={() => setIndex(headIndex)}>
                  Back to now
                </button>
              </span>
            </div>
          )}
          <table className="kd-tt__table">
            <caption className="kd-sr-only">
              Files in Studio at v{cur.v}
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Size</th>
                <th scope="col" className="kd-tt__col-mod">
                  Modified
                </th>
                <th scope="col">
                  <span className="kd-sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.notYet ? 'is-notyet' : r.chip === 'deleted' ? 'is-deleted' : r.chip ? 'is-changed' : ''}>
                  <td className="kd-tt__name">
                    {/* the cell stays a table cell (its hairline lines up with the row); the flex row is inside */}
                    <span className="kd-tt__namewrap">
                      <FileIcon dir={r.dir} ghost={r.notYet || r.chip === 'deleted'} />
                      <span title={r.name}>{r.name}</span>
                    </span>
                  </td>
                  <td className="kd-mono">{r.size}</td>
                  <td className="kd-mono kd-tt__col-mod">{r.modified}</td>
                  <td className="kd-tt__chipcell">
                    {r.notYet ? <span className="kd-chip is-ghost">
                        <span className="kd-tt__addedword">added </span>in v{r.addedIn}
                      </span> : r.chip && <span className="kd-chip">{r.chip}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Timeline list={list} index={index} onChange={setIndex} />
    </div>
  );
}
