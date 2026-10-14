'use client';

// Settings → Storage (UNIFY-SPEC §14.4 blocks): what the user's own drives hold by kind of file, their
// largest files, what version history keeps restorable, and who is using the space in shared drives.
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  RETENTION_COPY,
  STORAGE_CATEGORIES,
  basename,
  dirname,
  formatBytes,
  type CategoryUsage,
  type StorageCategory,
  type StoragePerson,
  type WorkspaceSummary,
} from '@volumes/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { Meter } from '@/components/ui/meter';
import { useStorageOverview, useStoragePeople } from '@/lib/api/hooks';
import { driveHref } from '@/lib/urls';
import { useVx } from '@/lib/store';
import { Section, SectionError } from './section';
import { percent } from './storage-section';

export const CATEGORY_LABEL: Record<StorageCategory, string> = {
  images: 'Photos and images',
  videos: 'Videos',
  audio: 'Audio',
  documents: 'Documents',
  code: 'Code',
  archives: 'Archives',
  other: 'Other',
};

/** The file-type tile colours (`--vx-ft-*`), so a category looks the same here as on its files, in both themes. */
export const CATEGORY_COLOR: Record<StorageCategory, string> = {
  images: 'var(--vx-ft-image)',
  videos: 'var(--vx-ft-photo)',
  audio: 'var(--vx-ft-slides)',
  documents: 'var(--vx-ft-doc)',
  code: 'var(--vx-ft-sheet)',
  archives: 'var(--vx-ft-archive)',
  other: 'var(--vx-ft-other)',
};
/** What the quota counts beyond the files' own sizes. */
const OVERHEAD_COLOR = 'var(--vx-tick)';

export interface Segment {
  key: StorageCategory | 'overhead';
  bytes: number;
  /** Width in % of the bar. */
  pct: number;
}

/**
 * The segments of a stacked bar over `total` bytes (the quota, or a drive's size): each category with
 * bytes, in the fixed category order, then `overhead` when given. A segment with any bytes is at least
 * 0.6% wide so it stays visible; the bar never overflows 100%.
 */
export function segments(cats: CategoryUsage[], total: number, overhead = 0): Segment[] {
  const by = new Map(cats.map((c) => [c.category, c.bytes]));
  const out: Segment[] = [];
  for (const key of STORAGE_CATEGORIES) {
    const bytes = by.get(key) ?? 0;
    if (bytes > 0) out.push({ key, bytes, pct: 0 });
  }
  if (overhead > 0) out.push({ key: 'overhead', bytes: overhead, pct: 0 });
  if (!out.length) return out;
  const sum = out.reduce((s, x) => s + x.bytes, 0);
  const denom = Math.max(total, sum);
  for (const s of out) s.pct = denom > 0 ? Math.max(0.6, (s.bytes / denom) * 100) : 0;
  const over = out.reduce((s, x) => s + x.pct, 0) - 100;
  // Minimum widths can push a full stack past the bar: take the excess from the widest segment.
  if (over > 0) {
    const widest = out.reduce((a, b) => (b.pct > a.pct ? b : a));
    widest.pct = Math.max(0.6, widest.pct - over);
  }
  return out;
}

/** `/drive/<folder>?ws=<id>&file=<name>`: opens the file's preview in its drive (lib/deep-link.ts). */
export function fileHref(ws: string, path: string): string {
  const q = new URLSearchParams({ ws, file: basename(path) });
  return `${driveHref(dirname(path))}?${q.toString()}`;
}

/** "Owner" · "Editor" · "Viewer" · "Former member". */
export function roleLabel(role: StoragePerson['role']): string {
  return role === 'former' ? 'Former member' : role[0].toUpperCase() + role.slice(1);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function segmentLabel(s: Segment): string {
  return s.key === 'overhead' ? 'Folders and rounding' : CATEGORY_LABEL[s.key];
}

/** A stacked bar: one coloured segment per category on the meter track, with a 1 px gap between segments. */
function StackedBar({ parts, height = 8, label }: { parts: Segment[]; height?: number; label: string }) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${parts.map((p) => `${segmentLabel(p)} ${formatBytes(p.bytes)}`).join(', ') || 'empty'}`}
      className="flex w-full gap-px overflow-hidden rounded-vx-xs bg-vx-meter-track"
      style={{ height }}
    >
      {parts.map((p) => (
        <span
          key={p.key}
          title={`${segmentLabel(p)} · ${formatBytes(p.bytes)}`}
          className="block h-full shrink-0 first:rounded-l-vx-xs"
          style={{ width: `${p.pct}%`, background: p.key === 'overhead' ? OVERHEAD_COLOR : CATEGORY_COLOR[p.key] }}
        />
      ))}
    </span>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

function Skeleton() {
  return <span className="skeleton block h-16 w-full" />;
}

// ── overview ────────────────────────────────────────────────────────────────

export function StorageOverviewSection() {
  const { data, error } = useStorageOverview();
  const current = useVx((s) => s.workspaceId);
  const body = !data ? (
    error ? (
      <SectionError>Couldn&apos;t load your storage.</SectionError>
    ) : (
      <Skeleton />
    )
  ) : (
    (() => {
      const overhead = Math.max(0, data.usedBytes - data.fileBytes);
      const pct = percent(data.usedBytes, data.quotaBytes);
      // Drive bars share one scale (the biggest drive), so they compare at a glance.
      const scale = Math.max(1, ...data.drives.map((d) => d.bytes));
      return (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="vx-meta-row text-vx-text-3">
              <span className="font-medium text-vx-text-1">{formatBytes(data.usedBytes)}</span> of {formatBytes(data.quotaBytes)} used
            </span>
            <span className={cx('vx-meta', data.level === 'red' ? 'font-medium text-vx-danger' : data.level === 'amber' ? 'text-vx-warn' : 'text-vx-text-3')}>
              {pct}%
            </span>
          </div>
          <div role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={data.quotaBytes} aria-valuenow={data.usedBytes} className="mt-2">
            <Meter value={data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 1} level={data.level} height={6} />
          </div>

          <h3 className="vx-micro mt-6 text-vx-text-3">What&apos;s using it</h3>
          <div className="mt-2">
            <StackedBar parts={segments(data.categories, data.usedBytes, overhead)} height={10} label="Storage used by kind of file" />
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 max-[520px]:grid-cols-1" aria-label="Storage by kind of file">
            {data.categories.map((c) => (
              <li key={c.category} className={cx('flex items-center gap-2', c.files === 0 && 'opacity-60')}>
                <Swatch color={CATEGORY_COLOR[c.category]} />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-vx-text-1">{CATEGORY_LABEL[c.category]}</span>
                <span className="vx-meta text-vx-text-3">{plural(c.files, 'file')}</span>
                <span className="vx-meta-row w-[72px] text-right text-vx-text-2">{formatBytes(c.bytes)}</span>
              </li>
            ))}
            {overhead > 0 ? (
              <li className="flex items-center gap-2" title="Your quota counts each file in whole 4 KB pages, and 4 KB for each folder.">
                <Swatch color={OVERHEAD_COLOR} />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-vx-text-2">Folders and rounding</span>
                <span className="vx-meta-row w-[72px] text-right text-vx-text-2">{formatBytes(overhead)}</span>
              </li>
            ) : null}
          </ul>

          {data.drives.length > 0 ? (
            <ul className="mt-6 flex flex-col gap-3 border-t border-vx-hair-soft pt-4" aria-label="Storage by drive">
              {data.drives.map((d) => (
                <li key={d.workspaceId} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_80px] items-center gap-x-3 gap-y-1 max-[480px]:grid-cols-[minmax(0,1fr)_72px]">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium leading-5 text-vx-text-1" title={d.name}>
                      {d.name}
                      {d.workspaceId === current ? <span className="vx-meta ml-1.5 font-normal text-vx-text-3">current</span> : null}
                    </span>
                    <span className="vx-meta block truncate text-vx-text-3">
                      {plural(d.files, 'file')}
                      {d.members > 0 ? (
                        <>
                          {' · '}
                          <a href={`#people-${d.workspaceId}`} className="underline-offset-4 hover:text-vx-text-1 hover:underline">
                            {plural(d.members + 1, 'person', 'people')}
                          </a>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="max-[480px]:order-last max-[480px]:col-span-2">
                    <StackedBar parts={segments(d.categories, scale, Math.max(0, d.bytes - d.fileBytes))} height={6} label={`${d.name} by kind of file`} />
                  </span>
                  <span className="vx-meta-row text-right text-vx-text-3">{formatBytes(d.bytes)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {data.partial ? (
            <p className="vx-micro mt-3 text-vx-text-3">Some drives are too large to list in full here: their breakdown covers the first 200,000 items.</p>
          ) : null}
        </>
      );
    })()
  );
  return (
    <Section
      id="overview"
      label="Overview"
      description="Your own drives. Drives other people share with you count against their owners."
      aside={
        <Link href="/pricing" className="vx-meta inline-flex items-center gap-1 text-vx-text-2 underline-offset-4 hover:text-vx-text-1 hover:underline">
          Need more space? See plans
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
        </Link>
      }
    >
      {body}
    </Section>
  );
}

// ── largest files ───────────────────────────────────────────────────────────

export function LargestFilesSection() {
  const { data, error } = useStorageOverview();
  const several = (data?.drives.length ?? 0) > 1;
  return (
    <Section id="largest" label="Largest files" description="The biggest files across your drives. Open one to preview it where it lives.">
      {!data ? (
        error ? <SectionError>Couldn&apos;t load your largest files.</SectionError> : <Skeleton />
      ) : data.largest.length === 0 ? (
        <p className="vx-body text-vx-text-3">No files yet.</p>
      ) : (
        <ol aria-label="Largest files">
          {data.largest.map((f) => {
            const folder = dirname(f.path);
            return (
              <li key={`${f.workspaceId}:${f.path}`} className="-mx-3 border-t border-vx-hair-soft first:border-t-0">
                <Link
                  href={fileHref(f.workspaceId, f.path)}
                  className="flex items-center gap-3 rounded-vx-sm px-3 py-2.5 transition-colors duration-[120ms] hover:bg-vx-raise"
                >
                  <FileIcon name={f.path} type="file" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium leading-5 text-vx-text-1" title={f.path}>
                      {basename(f.path)}
                    </span>
                    <span className="vx-meta block truncate text-vx-text-3" title={`${f.workspaceName} ${folder}`}>
                      {several ? `${f.workspaceName} · ` : ''}
                      {folder === '/' ? 'Top level' : folder}
                    </span>
                  </span>
                  <span className="vx-meta-row shrink-0 text-right text-vx-text-2">{formatBytes(f.size)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

// ── version history ─────────────────────────────────────────────────────────

export function HistorySection() {
  const { data, error } = useStorageOverview();
  const h = data?.history;
  return (
    <Section id="history" label="Version history" description={RETENTION_COPY}>
      {!h ? (
        error ? <SectionError>Couldn&apos;t load your history.</SectionError> : <Skeleton />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 max-[520px]:grid-cols-1">
            <div>
              <dt className="vx-micro text-vx-text-3">Replaced in the last {h.windowDays} days</dt>
              <dd className="mt-0.5 text-[14px] leading-5 text-vx-text-1">
                <span className="font-medium">{formatBytes(h.replacedBytes)}</span>
                <span className="vx-meta ml-2 text-vx-text-3">{plural(h.replacedFiles, 'file')}</span>
              </dd>
            </div>
            <div>
              <dt className="vx-micro text-vx-text-3">Deleted in the last {h.windowDays} days</dt>
              <dd className="mt-0.5 text-[14px] leading-5 text-vx-text-1">
                <span className="font-medium">{formatBytes(h.deletedBytes)}</span>
                <span className="vx-meta ml-2 text-vx-text-3">{plural(h.deletedItems, 'item')}</span>
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-col gap-1.5 border-t border-vx-hair-soft pt-4">
            <p className="vx-micro text-vx-text-3">
              Earlier versions keep what was replaced or deleted restorable, and none of it counts toward your quota. Versions share unchanged
              data, so the space history takes on disk is not shown: these are the sizes of the files as they were.
            </p>
            <Link href="/recently-deleted" className="vx-micro inline-flex w-fit items-center gap-1 text-vx-text-2 underline-offset-4 hover:text-vx-text-1 hover:underline">
              Recently deleted
              <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
            </Link>
          </div>
        </>
      )}
    </Section>
  );
}

// ── people in shared drives ─────────────────────────────────────────────────

interface SharedDrive {
  id: string;
  name: string;
  /** Null for the user's own drives. */
  owner: WorkspaceSummary['owner'];
}

/** One drive's split by person: a bar per person over the drive's current files. */
function DrivePeople({ drive }: { drive: SharedDrive }) {
  const me = useVx((s) => s.me);
  const { data, error } = useStoragePeople(drive.id);
  const anchor = `people-${drive.id}`;

  // Arriving from a drive's "N people" link (or a pasted #people-<id>): bring the block into view once it has its height.
  useEffect(() => {
    if (data && typeof window !== 'undefined' && window.location.hash === `#${anchor}`) {
      document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    }
  }, [data, anchor]);

  const total = data?.fileBytes ?? 0;
  return (
    <div id={anchor} className="scroll-mt-4 border-t border-vx-hair-soft pt-4 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 truncate text-[14px] font-semibold leading-5 text-vx-text-1">{drive.name}</h3>
        <span className="vx-meta text-vx-text-3">
          {drive.owner ? `Shared by ${drive.owner.name || drive.owner.email} · counts against their quota` : 'Your drive · counts against your quota'}
        </span>
      </div>
      {!data ? (
        error ? <SectionError>Couldn&apos;t load who is using this drive.</SectionError> : <span className="skeleton block h-10 w-full" />
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label={`Who is using ${drive.name}`}>
            {data.people.map((p) => (
              <PersonRow key={p.person.id} p={p} total={total} you={p.person.id === me?.user.id} />
            ))}
            {data.untracked.files > 0 ? (
              <li className="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_96px] items-center gap-3 max-[520px]:grid-cols-[24px_minmax(0,1fr)_88px]">
                <span aria-hidden className="h-6 w-6 rounded-full border border-dashed border-vx-hair-dash" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] leading-5 text-vx-text-2">Not attributed</span>
                  <span className="vx-meta block truncate text-vx-text-3" title="Files with no recorded writer: a duplicated drive's original files, or files whose writer's account was deleted.">
                    {plural(data.untracked.files, 'file')} from before changes were recorded
                  </span>
                </span>
                <ShareBar bytes={data.untracked.bytes} total={total} muted />
                <ShareFigure bytes={data.untracked.bytes} total={total} />
              </li>
            ) : null}
          </ul>
          {data.partial ? <p className="vx-micro mt-3 text-vx-text-3">This drive is large: the split covers part of it.</p> : null}
        </>
      )}
    </div>
  );
}

function ShareBar({ bytes, total, muted }: { bytes: number; total: number; muted?: boolean }) {
  const pct = total > 0 ? (bytes / total) * 100 : 0;
  return (
    <span aria-hidden className="block h-1.5 overflow-hidden rounded-vx-xs bg-vx-meter-track max-[520px]:order-last max-[520px]:col-span-3 max-[520px]:ml-9">
      <span className={cx('block h-full rounded-vx-xs', muted ? 'bg-vx-tick' : 'bg-vx-accent')} style={{ width: bytes > 0 ? `max(2px, ${pct}%)` : 0 }} />
    </span>
  );
}

function ShareFigure({ bytes, total }: { bytes: number; total: number }) {
  return (
    <span className="text-right">
      <span className="vx-meta-row block text-vx-text-1">{formatBytes(bytes)}</span>
      <span className="vx-meta block text-vx-text-3">{percent(bytes, total || 1)}%</span>
    </span>
  );
}

function PersonRow({ p, total, you }: { p: StoragePerson; total: number; you: boolean }) {
  const name = p.person.name || p.person.email;
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_96px] items-center gap-3 max-[520px]:grid-cols-[24px_minmax(0,1fr)_88px]">
      <Avatar name={name} size={24} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1" title={p.person.email}>
            {name}
            {you ? <span className="vx-meta ml-1.5 font-normal text-vx-text-3">you</span> : null}
          </span>
          <Badge tone={p.role === 'former' ? 'dashed' : 'neutral'}>{roleLabel(p.role)}</Badge>
        </span>
        <span className="vx-meta block truncate text-vx-text-3">
          {plural(p.files, 'file')}
          {p.agentBytes > 0 ? ` · ${formatBytes(p.agentBytes)} by AI agents` : ''}
        </span>
      </span>
      <ShareBar bytes={p.bytes} total={total} />
      <ShareFigure bytes={p.bytes} total={total} />
    </li>
  );
}

export function SharedPeopleSection() {
  const me = useVx((s) => s.me);
  const { data } = useStorageOverview();
  const own: SharedDrive[] = (data?.drives ?? []).filter((d) => d.members > 0).map((d) => ({ id: d.workspaceId, name: d.name, owner: null }));
  const shared: SharedDrive[] = (me?.workspaces ?? []).filter((w) => w.role !== 'owner').map((w) => ({ id: w.id, name: w.name, owner: w.owner }));
  const drives = [...own, ...shared];
  return (
    <Section
      id="people"
      label="People in shared drives"
      description="Each file counts toward whoever last uploaded, edited, copied or restored it. Moving or renaming a file doesn't change that, and an AI agent's changes count toward the person it works for."
    >
      {!data && !shared.length ? (
        <Skeleton />
      ) : drives.length === 0 ? (
        <p className="vx-body text-vx-text-3">When you share a drive, or someone shares one with you, you&apos;ll see who is using its space here.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {drives.map((d) => (
            <DrivePeople key={d.id} drive={d} />
          ))}
        </div>
      )}
    </Section>
  );
}
