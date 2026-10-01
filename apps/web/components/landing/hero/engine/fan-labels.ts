// The version labels of each volume's fan (LANDING-SPEC §5.6), newest first,
// one per slice. Studio's history is the same data as the time-travel stage
// (§6.2): v44 two minutes ago, v40 ◆ "before launch", v38 Tue 14:08 … so the
// hero and the stage never contradict each other.
import type { VolumeSpec } from './layout';

export interface FanLabel {
  text: string;
  bright: boolean;
  checkpoint: boolean;
  /** The slice this label belongs to (compact sets label only some slices). */
  slice: number;
}

/** [version, when] or [version, checkpoint label, true], newest first; six per volume. */
type Row = [number, string] | [number, string, true];

const HISTORY: Record<string, Row[]> = {
  Studio: [[44, '2 min ago'], [40, 'before launch', true], [38, 'Tue 14:08'], [36, 'Tue 11:02'], [33, 'first draft', true], [30, 'Mon 09:12']],
  Thesis: [[18, '3 days ago'], [17, '4 days ago'], [15, 'submitted', true], [12, 'last week'], [9, '2 weeks ago'], [4, 'last month']],
  Research: [[31, '1 h ago'], [30, '3 h ago'], [28, 'yesterday'], [26, 'draft 2 sent', true], [22, 'Mon 10:40'], [18, 'last week']],
  Photos: [[12, 'just now'], [11, '10 min ago'], [9, 'trip sorted', true], [7, 'yesterday'], [4, 'Sat 18:20'], [1, 'last week']],
  'Studio · Tue copy': [[38, 'duplicated Tue'], [36, 'Tue 11:02'], [35, 'Tue 09:15'], [33, 'first draft', true], [31, 'Mon 11:40'], [30, 'Mon 09:12']],
  Brand: [[9, '5 days ago'], [8, '6 days ago'], [6, 'v1 brand', true], [5, '2 weeks ago'], [3, '3 weeks ago'], [1, 'last month']],
  Archive: [[57, 'last month'], [56, '2 months ago'], [54, 'year end', true], [50, 'November'], [44, 'October'], [38, 'September']],
};

function historyOf(v: VolumeSpec): Row[] {
  return HISTORY[v.name] ?? [[v.head, v.edited], [Math.max(1, v.head - 3), 'earlier']];
}

const text = (r: Row) => (r[2] ? `v${r[0]} ◆ "${r[1]}"` : `v${r[0]} · ${r[1]}`);

/**
 * Labels for `count` slices. Mobile keeps four rows: the head, the first
 * checkpoint, then the next newest (≤22 characters each). `compact` labels only
 * the head and the first checkpoint: the fallback where a full column cannot
 * clear the copy or the other cubes.
 */
export function fanLabels(v: VolumeSpec, count: number, compact = false, named = false): FanLabel[] {
  const all = historyOf(v);
  let rows = all.slice(0, count);
  if (count < all.length) {
    // keep the first checkpoint in view even when the stack is short
    const cp = all.findIndex((r) => r[2]);
    if (cp >= count) rows = [...all.slice(0, count - 1), all[cp]];
  }
  // beside the stack (desktop), the head row names the drive in place of its
  // time ("Studio · v44"), so the open fan still says whose versions these are
  // once the hover tag is gone, at the column's usual width
  const head = (r: Row) => (r[2] ? text(r) : `${v.name} · v${r[0]}`);
  const labels = rows.map((r, i): FanLabel => ({ text: i === 0 && named ? head(r) : text(r), bright: i === 0 || !!r[2], checkpoint: !!r[2], slice: i }));
  if (!compact) return labels;
  const cp = labels.find((l) => l.checkpoint);
  return cp ? [labels[0], cp] : [labels[0]];
}

/** The hover tag's first line, e.g. "Studio · v44 · 2 min ago". */
export function tagLine(v: VolumeSpec): string {
  return v.kind === 'ghost' ? `${v.name} · from v${v.head}` : `${v.name} · v${v.head} · ${v.edited}`;
}
