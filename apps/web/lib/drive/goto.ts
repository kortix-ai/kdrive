// Search palette "GO TO" (DESIGN §6.14): `@a41f` matches loaded commits;
// `yesterday 16:00`, `14 sep`, `2026-09-14 16:40` jump to the nearest version
// at or before that moment.
import { endOfDay, endOfMinute, isValid, parse, subDays } from 'date-fns';

export interface GoToEntry {
  commitId: string;
  createdAt: string;
  summary: string;
  isHead: boolean;
}

const DATE_FORMATS = [
  'd MMM yyyy HH:mm',
  'd MMM yyyy',
  'd MMM HH:mm',
  'd MMM, HH:mm',
  'd MMM',
  'MMM d HH:mm',
  'MMM d',
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd',
  'd/M/yyyy HH:mm',
  'd/M/yyyy',
  'HH:mm',
];

/** A moment for a typed date, or null. `exact` is false for a whole day. */
export function parseWhen(input: string, now: Date = new Date()): { at: Date; exact: boolean } | null {
  const q = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const rel = /^(today|yesterday|now)(?: (?:at )?(\d{1,2}):(\d{2}))?$/.exec(q);
  if (rel) {
    if (rel[1] === 'now') return { at: now, exact: true };
    const day = rel[1] === 'yesterday' ? subDays(now, 1) : now;
    if (rel[2]) {
      const d = new Date(day);
      d.setHours(Number(rel[2]), Number(rel[3]), 0, 0);
      return { at: endOfMinute(d), exact: true };
    }
    return { at: endOfDay(day), exact: false };
  }
  for (const f of DATE_FORMATS) {
    const d = parse(q, f, now);
    if (!isValid(d)) continue;
    const hasTime = f.includes('HH');
    // "14 sep" in the future means last year
    if (!f.includes('yyyy') && d.getTime() > now.getTime() && f !== 'HH:mm') d.setFullYear(d.getFullYear() - 1);
    return hasTime ? { at: endOfMinute(d), exact: true } : { at: endOfDay(d), exact: false };
  }
  return null;
}

/** Entries matching the query: commit prefix (`@…`) or nearest at/before a date. Newest-first input. */
export function goToMatches(q: string, entries: readonly GoToEntry[], now: Date = new Date()): { entry: GoToEntry; label: 'commit' | 'nearest' }[] {
  const t = q.trim();
  if (!t) return [];
  if (t.startsWith('@')) {
    const pre = t.slice(1).toLowerCase();
    if (!pre) return [];
    return entries
      .filter((e) => {
        const bare = e.commitId.replace(/^[a-z]{2,4}_/i, '').toLowerCase();
        return bare.startsWith(pre) || e.commitId.toLowerCase().startsWith(pre);
      })
      .slice(0, 5)
      .map((entry) => ({ entry, label: 'commit' as const }));
  }
  const when = parseWhen(t, now);
  if (!when) return [];
  const hit = entries.find((e) => new Date(e.createdAt).getTime() <= when.at.getTime());
  return hit ? [{ entry: hit, label: 'nearest' }] : [];
}
