// Words and tones shared by the proposals inbox and the review page (MCP.md §14.6-14.7).
import type { ProposalChange, ProposalCounts, ProposalFile, ProposalStatus, ProposalSummary } from '@volumes/shared';
import type { BadgeTone } from '@/components/ui/badge';

const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;

/** "Add 2 files, edit 1, remove 1" from the counts, for a proposal that came without a message. */
export function generatedSummary(c: ProposalCounts): string {
  const parts: string[] = [];
  const push = (k: number, verb: string) => {
    if (k > 0) parts.push(parts.length ? `${verb} ${k.toLocaleString('en-US')}` : `${verb} ${n(k, 'file')}`);
  };
  push(c.added, 'Add');
  push(c.modified, 'Edit');
  push(c.removed, 'Remove');
  push(c.moved, 'Move');
  push(c.copied, 'Copy');
  if (c.folders > 0) parts.push(parts.length ? `create ${n(c.folders, 'folder')}` : `Create ${n(c.folders, 'folder')}`);
  if (!parts.length) return 'Suggested changes';
  return parts.map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p)).join(', ');
}

/** The line a proposal is known by: the agent's message, else the generated summary. */
export function proposalTitle(p: Pick<ProposalSummary, 'message' | 'counts'>): string {
  const m = p.message.trim();
  return m || generatedSummary(p.counts);
}

export const CHANGE_LABEL: Record<ProposalChange, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
  moved: 'Moved',
  copied: 'Copied',
  folder: 'Folder',
};

export const CHANGE_TONE: Record<ProposalChange, BadgeTone> = {
  added: 'add',
  modified: 'neutral',
  removed: 'del',
  moved: 'neutral',
  copied: 'neutral',
  folder: 'neutral',
};

/** Count chips of an inbox row, in reading order; zero counts are left out. */
export function countChips(c: ProposalCounts): { key: keyof ProposalCounts; text: string; tone: BadgeTone; title: string }[] {
  const all: { key: keyof ProposalCounts; sign: string; tone: BadgeTone; one: string; many?: string }[] = [
    { key: 'added', sign: '+', tone: 'add', one: 'file added', many: 'files added' },
    { key: 'modified', sign: '~', tone: 'neutral', one: 'file modified', many: 'files modified' },
    { key: 'removed', sign: '−', tone: 'del', one: 'file removed', many: 'files removed' },
    { key: 'moved', sign: '↪', tone: 'neutral', one: 'item moved', many: 'items moved' },
    { key: 'copied', sign: '⧉', tone: 'neutral', one: 'item copied', many: 'items copied' },
    { key: 'folders', sign: '▢', tone: 'neutral', one: 'new folder', many: 'new folders' },
  ];
  return all
    .filter((x) => c[x.key] > 0)
    .map((x) => ({ key: x.key, text: `${x.sign}${c[x.key].toLocaleString('en-US')}`, tone: x.tone, title: n(c[x.key], x.one, x.many) }));
}

/** State badge of a decided proposal (none while it is open). */
export function statusBadge(s: ProposalStatus): { label: string; tone: BadgeTone } | null {
  switch (s) {
    case 'accepted':
      return { label: 'Accepted', tone: 'live' };
    case 'partial':
      return { label: 'Partly accepted', tone: 'neutral' };
    case 'discarded':
      return { label: 'Discarded', tone: 'dashed' };
    case 'expired':
      return { label: 'Expired', tone: 'dashed' };
    default:
      return null;
  }
}

/** "notes/a.md → archive/a.md" for moves and copies, else the path. */
export function fileLabel(f: Pick<ProposalFile, 'path' | 'fromPath' | 'op'>): string {
  return (f.op === 'move' || f.op === 'copy') && f.fromPath ? `${f.fromPath} → ${f.path}` : f.path;
}

/** Keeps the start and the end of a long path: "/reports/…/q3/summary.md". */
export function middleTruncate(s: string, max = 48): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  const tail = keep - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export function changesWord(k: number): string {
  return n(k, 'change');
}

export { n as countWord };

/** The first page from SWR, then the pages "Load more" fetched (deduplicated by id). */
export function mergePages(first: ProposalSummary[], more: ProposalSummary[]): ProposalSummary[] {
  const seen = new Set(first.map((p) => p.id));
  const out = [...first];
  for (const p of more) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
