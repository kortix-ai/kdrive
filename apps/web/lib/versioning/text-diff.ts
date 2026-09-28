// Line diff with word-level highlights for the compare view (DESIGN.md §6.7).
// Pure functions (no React), so they run in `bun test`.

import { diffLines, diffWordsWithSpace, type ChangeObject } from 'diff';

export type SegKind = 'same' | 'add' | 'del';
export interface Seg {
  text: string;
  kind: SegKind;
}

/** One line on one side. `segs` is set on paired changed lines (word-level highlight). */
export interface LineSide {
  num: number;
  text: string;
  segs?: Seg[];
}

/** A side-by-side row. A `change` row has a removed line (a), an added line (b), or both (a changed pair). */
export type SplitRow =
  | { type: 'same'; a: LineSide; b: LineSide }
  | { type: 'change'; a: LineSide | null; b: LineSide | null; block: number };

export interface UnifiedRow {
  type: SegKind;
  aNum: number | null;
  bNum: number | null;
  text: string;
  segs?: Seg[];
  /** Change block number (0-based) for add/del rows. */
  block?: number;
}

export interface TextDiff {
  split: SplitRow[];
  unified: UnifiedRow[];
  /** Lines only in b. */
  added: number;
  /** Lines only in a. */
  removed: number;
  /** Number of contiguous change blocks ("3 changes"). */
  blocks: number;
  identical: boolean;
}

/** Word highlights are skipped on very long lines (minified files) to keep the diff fast. */
const WORD_DIFF_MAX_LINE = 2000;

/** CRLF/CR → LF; JSON is pretty-printed (2 spaces) when it parses, so formatting noise does not hide real changes. */
export function normalizeText(text: string, opts: { json?: boolean } = {}): string {
  let t = text.replace(/\r\n?/g, '\n');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  if (opts.json) {
    try {
      t = JSON.stringify(JSON.parse(t), null, 2) + '\n';
    } catch {
      /* not valid JSON: diff it as text */
    }
  }
  return t;
}

/** 'a\nb\n' → ['a','b']; 'a\nb' → ['a','b']; '' → []. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Word-level segments for a changed pair: `a` gets same+del, `b` gets same+add. */
export function wordSegments(aLine: string, bLine: string): { a: Seg[]; b: Seg[] } {
  if (aLine.length > WORD_DIFF_MAX_LINE || bLine.length > WORD_DIFF_MAX_LINE) {
    return { a: [{ text: aLine, kind: 'del' }], b: [{ text: bLine, kind: 'add' }] };
  }
  const parts = diffWordsWithSpace(aLine, bLine);
  const a: Seg[] = [];
  const b: Seg[] = [];
  const push = (arr: Seg[], s: Seg) => {
    const last = arr[arr.length - 1];
    if (last && last.kind === s.kind) last.text += s.text;
    else arr.push(s);
  };
  for (const p of parts) {
    if (p.added) push(b, { text: p.value, kind: 'add' });
    else if (p.removed) push(a, { text: p.value, kind: 'del' });
    else {
      push(a, { text: p.value, kind: 'same' });
      push(b, { text: p.value, kind: 'same' });
    }
  }
  return { a, b };
}

const withFinalNewline = (s: string) => (s === '' || s.endsWith('\n') ? s : s + '\n');

/**
 * Side-by-side + unified line diff of two texts. Returns null when the diff would take
 * longer than `timeoutMs` (too many changes to align line by line).
 */
export function computeTextDiff(aText: string, bText: string, opts: { timeoutMs?: number } = {}): TextDiff | null {
  const a = withFinalNewline(aText);
  const b = withFinalNewline(bText);
  let changes: ChangeObject<string>[] | undefined;
  if (a === b) {
    changes = a ? [{ value: a, count: splitLines(a).length, added: false, removed: false }] : [];
  } else {
    changes = diffLines(a, b, { timeout: opts.timeoutMs ?? 2500 });
    if (!changes) return null;
  }

  const split: SplitRow[] = [];
  const unified: UnifiedRow[] = [];
  let aNum = 0;
  let bNum = 0;
  let added = 0;
  let removed = 0;
  let blocks = 0;
  let pendingDel: string[] = [];
  let pendingAdd: string[] = [];

  const flush = () => {
    if (!pendingDel.length && !pendingAdd.length) return;
    const block = blocks++;
    const pairs = Math.min(pendingDel.length, pendingAdd.length);
    const n = Math.max(pendingDel.length, pendingAdd.length);
    const uDel: UnifiedRow[] = [];
    const uAdd: UnifiedRow[] = [];
    for (let i = 0; i < n; i++) {
      const dl = i < pendingDel.length ? pendingDel[i] : null;
      const al = i < pendingAdd.length ? pendingAdd[i] : null;
      let aSide: LineSide | null = null;
      let bSide: LineSide | null = null;
      if (i < pairs && dl !== null && al !== null) {
        const w = wordSegments(dl, al);
        aSide = { num: ++aNum, text: dl, segs: w.a };
        bSide = { num: ++bNum, text: al, segs: w.b };
      } else {
        if (dl !== null) aSide = { num: ++aNum, text: dl };
        if (al !== null) bSide = { num: ++bNum, text: al };
      }
      split.push({ type: 'change', a: aSide, b: bSide, block });
      if (aSide) uDel.push({ type: 'del', aNum: aSide.num, bNum: null, text: aSide.text, segs: aSide.segs, block });
      if (bSide) uAdd.push({ type: 'add', aNum: null, bNum: bSide.num, text: bSide.text, segs: bSide.segs, block });
    }
    unified.push(...uDel, ...uAdd);
    removed += pendingDel.length;
    added += pendingAdd.length;
    pendingDel = [];
    pendingAdd = [];
  };

  for (const c of changes) {
    const lines = splitLines(c.value);
    if (c.removed) pendingDel.push(...lines);
    else if (c.added) pendingAdd.push(...lines);
    else {
      flush();
      for (const line of lines) {
        const as: LineSide = { num: ++aNum, text: line };
        const bs: LineSide = { num: ++bNum, text: line };
        split.push({ type: 'same', a: as, b: bs });
        unified.push({ type: 'same', aNum: as.num, bNum: bs.num, text: line });
      }
    }
  }
  flush();

  return { split, unified, added, removed, blocks, identical: blocks === 0 };
}

/** A collapsed run of unchanged rows: rows[start..end) are hidden. */
export interface Fold {
  type: 'fold';
  start: number;
  end: number;
  count: number;
}

/**
 * Collapses unchanged runs longer than `minRun` lines, keeping `context` lines next to each change.
 * `expanded` holds fold start indexes the user opened. Returns row indexes and fold markers in order.
 */
export function foldRows<T>(
  rows: T[],
  isSame: (row: T) => boolean,
  opts: { context?: number; minRun?: number; expanded?: ReadonlySet<number> } = {},
): (number | Fold)[] {
  const context = opts.context ?? 3;
  const minRun = opts.minRun ?? 6;
  const out: (number | Fold)[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!isSame(rows[i])) {
      out.push(i++);
      continue;
    }
    let j = i;
    while (j < rows.length && isSame(rows[j])) j++;
    const runLen = j - i;
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === rows.length ? 0 : context;
    const hidden = runLen - keepHead - keepTail;
    if (runLen > minRun && hidden > 0) {
      const start = i + keepHead;
      const end = j - keepTail;
      if (opts.expanded?.has(start)) {
        for (let k = i; k < j; k++) out.push(k);
      } else {
        for (let k = i; k < start; k++) out.push(k);
        out.push({ type: 'fold', start, end, count: end - start });
        for (let k = end; k < j; k++) out.push(k);
      }
    } else {
      for (let k = i; k < j; k++) out.push(k);
    }
    i = j;
  }
  return out;
}

/** "+14 −6 lines · 3 changes" */
export function diffSummary(d: Pick<TextDiff, 'added' | 'removed' | 'blocks'>): string {
  if (d.blocks === 0) return 'No line changes';
  const lines = d.added + d.removed === 1 ? 'line' : 'lines';
  return `+${d.added} −${d.removed} ${lines} · ${d.blocks} ${d.blocks === 1 ? 'change' : 'changes'}`;
}
