'use client';

import { useState } from 'react';
import { Tabs } from './bits';
import { PosterArt } from './poster-art';

// Compare (LANDING-SPEC §6.3a): text diff with word marks, an image swipe and
// changed CSV cells, behind one tablist. Local state only.
type Tab = 'text' | 'image' | 'csv';
const TABS = [
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'csv', label: 'CSV' },
] as const;
// file and range: on a phone only the range shows (the versions are the point)
const HEAD: Record<Tab, [string, string]> = {
  text: ['notes.md', 'v36 → v44'],
  image: ['hero.png', 'v33 → v44'],
  csv: ['budget.csv', 'v36 → v44'],
};

type Seg = string | { del: string } | { add: string };
const LINES: { kind: 'same' | 'del' | 'add'; segs: Seg[] }[] = [
  { kind: 'same', segs: ['# Launch notes'] },
  { kind: 'del', segs: ['Send the ', { del: 'first' }, ' draft to Sam on ', { del: 'Friday' }, '.'] },
  { kind: 'add', segs: ['Send the ', { add: 'final' }, ' draft to Sam on ', { add: 'Thursday' }, '.'] },
  { kind: 'same', segs: ['Print 40 copies on the heavy stock.'] },
  { kind: 'add', segs: ['Bring the spare cable for the projector.'] },
  { kind: 'del', segs: ['Order coffee for the room.'] },
];

function TextDiff() {
  return (
    <div className="kd-diff" role="table" aria-label="Changes to notes.md">
      {LINES.map((l, i) => (
        <div key={i} role="row" className={`kd-diff__row is-${l.kind}`}>
          <span role="cell" className="kd-diff__gutter" aria-label={l.kind === 'add' ? 'added' : l.kind === 'del' ? 'removed' : 'unchanged'}>
            {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
          </span>
          <span role="cell" className="kd-diff__text">
            {l.segs.map((s, j) =>
              typeof s === 'string' ? (
                s
              ) : 'del' in s ? (
                <del key={j}>{s.del}</del>
              ) : (
                <ins key={j}>{s.add}</ins>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function ImageSwipe() {
  const [x, setX] = useState(50);
  return (
    <div className="kd-swipe" style={{ '--kd-x': `${x}%` } as React.CSSProperties}>
      <PosterArt version="old" className="kd-swipe__img" />
      <PosterArt version="new" className="kd-swipe__img kd-swipe__img--new" />
      <span className="kd-swipe__bar" aria-hidden="true">
        <span />
      </span>
      <span className="kd-swipe__tag is-l">v33</span>
      <span className="kd-swipe__tag is-r">v44</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={x}
        onChange={(e) => setX(Number(e.target.value))}
        aria-label="Swipe between v33 and v44"
        aria-valuetext={`${x}% showing v33`}
        className="kd-swipe__input"
      />
    </div>
  );
}

function CsvDiff() {
  const cell = (old: string, now: string) => (
    <td className="is-changed">
      <s>{old}</s>
      <span>{now}</span>
    </td>
  );
  return (
    <table className="kd-csv">
      <caption className="kd-sr-only">Changed cells in budget.csv</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Qty</th>
          <th scope="col">Unit</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Print run</td>
          {cell('40', '60')}
          <td>12.00</td>
          {cell('480.00', '720.00')}
        </tr>
        <tr>
          <td>Venue</td>
          <td>1</td>
          <td>900.00</td>
          <td>900.00</td>
        </tr>
        <tr>
          <td>Coffee</td>
          <td>3</td>
          <td>18.00</td>
          <td>54.00</td>
        </tr>
      </tbody>
    </table>
  );
}

export function CompareMock() {
  const [tab, setTab] = useState<Tab>('text');
  return (
    <div className="kd-inset kd-cmp">
      <div className="kd-inset__bar">
        <Tabs label="Compare" tabs={TABS} value={tab} onChange={setTab} idBase="kd-cmp" />
        <span className="kd-inset__meta" title={HEAD[tab].join(' · ')}>
          <span className="kd-cmp__file">{HEAD[tab][0]} · </span>
          {HEAD[tab][1]}
        </span>
      </div>
      <div id="kd-cmp-panel" role="tabpanel" aria-labelledby={`kd-cmp-tab-${tab}`} className="kd-cmp__panel">
        {tab === 'text' && <TextDiff />}
        {tab === 'image' && <ImageSwipe />}
        {tab === 'csv' && <CsvDiff />}
      </div>
    </div>
  );
}
