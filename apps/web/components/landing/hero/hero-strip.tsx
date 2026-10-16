import { Fragment } from 'react';

// The mini time strip at the hero's foot: a preview of the app's strip. A week of versions as ticks (agent
// edits in cobalt), named checkpoints as ◆ with their labels centred over them, and the ember now-dot.
// Static and server-rendered: positions are fractions of the track, so it lays out without measuring.

export const STRIP_DAYS = ['Fri 10', 'Sat 11', 'Sun 12', 'Mon 13', 'Tue 14', 'Wed 15', 'Thu 16'];
const PER_DAY = [3, 2, 1, 5, 7, 5, 7];
const CHECKPOINTS: Record<number, string> = { 6: 'First draft', 18: 'Client review', 25: 'Launch' };

export type StripEntry = { v: number; at: number; agent: boolean; size: 0 | 1 | 2 };

/** Every version of the week, numbered from 1, placed as a fraction (0–1) of the week. */
export function stripEntries(): StripEntry[] {
  const out: StripEntry[] = [];
  let v = 1;
  PER_DAY.forEach((count, day) => {
    for (let i = 0; i < count; i++) {
      v += 1;
      out.push({ v: v - 1, at: (day + (i + 1) / (count + 1)) / 7, agent: v % 7 === 0, size: ((v * 7) % 3) as 0 | 1 | 2 });
    }
  });
  return out;
}

const ENTRIES = stripEntries();
const NOW = ENTRIES[ENTRIES.length - 1];

// L and R are the track's insets in px: the now label needs room on the right
const x = (at: number) => `calc(14px + (100% - 66px) * ${at.toFixed(4)})`;

export function HeroStrip() {
  return (
    <div className="kd-hstrip" role="img" aria-label="Every version of the drive this week, with three named checkpoints">
      <span className="kd-hstrip__line" style={{ left: '14px', width: `calc((100% - 66px) * ${NOW.at.toFixed(4)})` }} />
      {STRIP_DAYS.map((d, i) => (
        <Fragment key={d}>
          <span className="kd-hstrip__dtick" style={{ left: x(i / 7) }} />
          <span className="kd-hstrip__day" style={{ left: x((i + 0.5) / 7) }}>
            <span className="kd-hstrip__dname">{d.split(' ')[0]} </span>
            {d.split(' ')[1]}
          </span>
        </Fragment>
      ))}
      {ENTRIES.map((e) => {
        if (e === NOW) return null;
        const name = CHECKPOINTS[e.v];
        return name ? (
          <Fragment key={e.v}>
            <span className="kd-hstrip__dia" style={{ left: x(e.at) }} />
            <span className="kd-hstrip__flag" style={{ left: x(e.at) }}>
              {name}
            </span>
          </Fragment>
        ) : (
          <span key={e.v} className={`kd-hstrip__tick is-s${e.size}${e.agent ? ' is-agent' : ''}`} style={{ left: x(e.at) }} />
        );
      })}
      <span className="kd-hstrip__now" style={{ left: x(NOW.at) }} />
      <span className="kd-hstrip__nowlbl" style={{ left: `calc(${x(NOW.at)} + 14px)` }}>
        now
      </span>
    </div>
  );
}
