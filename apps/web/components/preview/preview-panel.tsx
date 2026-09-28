'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, History, Link2 } from 'lucide-react';
import { RETENTION_COPY, basename, dirname, formatBytes, isActiveContent, mimeFor, shortId, type FileStat } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useStat } from '@/lib/api/hooks';
import { formatDate, formatRelative, formatTimeTravelLabel, isoTitle } from '@/lib/format';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { contentUrl, zipUrl } from '@/lib/urls';
import { FilePreview, rendererFor } from './file-preview';
import { compareEntries, middleTruncate, stepSibling, typeLabel } from './names';
import { PreviewError, PreviewSkeleton } from './states';

const noRetry = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

/** Commit time for the "AS OF" chip (from the time-travel state when it matches, else the commit). */
function useCommitTime(ws: string | null, at: string | null): string | null | undefined {
  const tt = useVx((s) => s.timeTravel);
  const known = at && tt?.commitId === at ? tt.createdAt : null;
  const { data } = useSWR(ws && at && !known ? ['commit', ws, at] : null, () => api.versioning.commit(ws!, at!), noRetry);
  if (!at) return null;
  return known ?? data?.createdAt;
}

/** Siblings of `path` (files only, drive order) at `at`; shares the drive's listing cache key. */
function useSiblings(ws: string | null, path: string, at: string | null): string[] {
  const parent = dirname(path);
  // Key-derived fetcher (see useListing): never a closure over `at`.
  const { data } = useSWR(ws ? (['ls', ws, parent, at] as [string, string, string, string | null]) : null, ([, w, p, a]: [string, string, string, string | null]) => api.files.list(w, { path: p, at: a }), {
    ...noRetry,
    keepPreviousData: true,
  });
  return useMemo(
    () => (data ? [...data.entries].filter((e) => e.type === 'file').sort(compareEntries).map((e) => e.path) : []),
    [data],
  );
}

/** Esc closes the panel unless a dialog or menu is open (they own Esc first). */
function useEscToClose(enabled: boolean, close: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"],[role="menu"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      close();
    };
    // capture: runs before the drive's bubble-phase Esc (clear selection / back to now)
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, close]);
}

function Details({ stat, at }: { stat: FileStat; at: string | null }) {
  const [open, setOpen] = useState(false);
  const rows: [string, React.ReactNode][] = [
    ['path', <span key="p" className="break-all">{stat.path}</span>],
    [
      'size',
      stat.type === 'dir' ? '—' : (
        <span key="s">
          {formatBytes(stat.size)} <span className="vx-unit">· {stat.size.toLocaleString('en-US')} bytes</span>
        </span>
      ),
    ],
    ['type', stat.type === 'dir' ? 'folder' : mimeFor(stat.name).split(';')[0]],
    ['modified', <span key="m" title={isoTitle(stat.mtime)}>{formatDate(stat.mtime)}</span>],
    ['version', stat.version ? <span key="v" title={stat.version}>{shortId('vc_' + stat.version)}</span> : '—'],
    ['read at', <span key="c" title={stat.commitId}>{at ? shortId(stat.commitId) : `now · ${shortId(stat.commitId)}`}</span>],
  ];
  return (
    <div className="border-t border-vx-hair">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="vx-label flex h-9 w-full items-center gap-2 px-4 text-left hover:text-vx-text-1"
      >
        Details
        <ChevronDown size={12} className={cx('transition-transform duration-[120ms]', open ? '' : '-rotate-90')} aria-hidden />
      </button>
      {open ? (
        <dl className="vx-meta grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 px-4 pb-4">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-vx-text-4">{k}</dt>
              <dd className="min-w-0 text-vx-text-2">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

const linkBtn =
  'inline-flex h-7 items-center gap-1.5 border border-vx-hair px-2.5 font-mono text-[12px] font-medium text-vx-text-2 transition-colors duration-[120ms] hover:border-vx-hair-strong hover:text-vx-text-1';

function FolderSummary({ ws, stat, at }: { ws: string; stat: FileStat; at: string | null }) {
  const openRestore = useVx((s) => s.openRestore);
  const { data, error } = useSWR(['ls', ws, stat.path, at], () => api.files.list(ws, { path: stat.path, at }), { ...noRetry, keepPreviousData: true });
  const files = data?.entries.filter((e) => e.type !== 'dir').length ?? 0;
  const dirs = data?.entries.filter((e) => e.type === 'dir').length ?? 0;
  const newest = data?.entries.reduce((m, e) => Math.max(m, e.mtime), 0) ?? 0;
  return (
    <div className="px-4 py-6">
      {error ? (
        <PreviewError status={error instanceof ApiError ? error.status : 500} code={error instanceof ApiError ? error.code : undefined} />
      ) : !data ? (
        <PreviewSkeleton className="px-0" />
      ) : (
        <dl className="vx-meta grid grid-cols-[88px_1fr] gap-y-1.5">
          <dt className="text-vx-text-4">items</dt>
          <dd className="text-vx-text-2">
            {data.entries.length} <span className="vx-unit">· {files} files, {dirs} folders</span>
          </dd>
          <dt className="text-vx-text-4">last change</dt>
          <dd className="text-vx-text-2" title={newest ? isoTitle(newest) : undefined}>
            {newest ? formatRelative(newest) : '—'}
          </dd>
        </dl>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <a href={zipUrl(ws, [stat.path], at)} className={linkBtn}>
          <Download size={13} aria-hidden /> Download .zip
        </a>
        {at ? (
          <Button size="sm" variant="restore" onClick={() => openRestore({ scope: 'folder', path: stat.path, at })}>
            Restore folder…
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The preview tab of the right-hand panel (`panel.kind === 'preview'`). */
export default function PreviewPanel() {
  const panel = useVx((s) => s.panel);
  const ws = useVx((s) => s.workspaceId);
  const selection = useVx((s) => s.selection);
  const timeTravel = useVx((s) => s.timeTravel);
  const { openPreview, openVersions, openShare, openRestore, closePanel, select, exitTimeTravel } = useVx.getState();

  const path = panel?.kind === 'preview' ? panel.path : null;
  const at = panel?.at ?? null;
  const { data: stat, error, isLoading, mutate } = useStat(path, at);
  const asOf = useCommitTime(ws, at);
  const siblings = useSiblings(ws, path ?? '/', at);
  const prev = path ? stepSibling(siblings, path, -1) : null;
  const next = path ? stepSibling(siblings, path, 1) : null;

  const go = (p: string | null) => {
    if (!p) return;
    openPreview(p, { at });
    select([p]);
  };

  useHotkeys(
    {
      arrowleft: (e) => {
        if ((e.target as HTMLElement | null)?.closest?.('video,audio')) return;
        go(prev);
      },
      arrowright: (e) => {
        if ((e.target as HTMLElement | null)?.closest?.('video,audio')) return;
        go(next);
      },
    },
    { enabled: !!path },
  );
  useEscToClose(!!path, closePanel);

  if (!panel || !path || !ws) return null;
  const name = basename(path) || '/';
  const selected = selection.length === 1 && selection[0] === path;
  const apiErr = error instanceof ApiError ? error : null;

  const header = (
    <div className="border-b border-vx-hair px-4 pb-3 pt-3">
      <div className="flex items-start gap-2">
        <h2 className="vx-title min-w-0 flex-1 truncate" title={path}>
          {middleTruncate(name, 44)}
        </h2>
        {at ? (
          <span
            className="vx-label mt-0.5 inline-flex h-5 shrink-0 items-center border border-vx-past-edge bg-vx-past-wash px-1.5 text-[9.5px] text-vx-past"
            title={asOf ? isoTitle(asOf) : at}
          >
            As of {asOf ? formatTimeTravelLabel(asOf) : '…'}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center">
          <IconButton label="Previous file (←)" size="sm" disabled={!prev} onClick={() => go(prev)}>
            <ChevronLeft size={14} />
          </IconButton>
          <IconButton label="Next file (→)" size="sm" disabled={!next} onClick={() => go(next)}>
            <ChevronRight size={14} />
          </IconButton>
        </div>
      </div>
      <div className="vx-meta mt-1 text-vx-text-3">
        {stat ? (
          stat.type === 'dir' ? (
            <>
              FOLDER <span className="vx-unit">·</span> modified <span title={isoTitle(stat.mtime)}>{formatRelative(stat.mtime)}</span>
            </>
          ) : (
            <>
              {typeLabel(stat.name)} <span className="vx-unit">·</span> {formatBytes(stat.size)} <span className="vx-unit">·</span> modified{' '}
              <span title={isoTitle(stat.mtime)}>{formatRelative(stat.mtime)}</span>
            </>
          )
        ) : (
          <span className="skeleton skel-line inline-block w-40" />
        )}
      </div>
      {stat && stat.type !== 'dir' ? (
        <div className="mt-3 flex flex-nowrap items-center gap-1.5">
          <a href={contentUrl(ws, path, { at, download: true })} className={linkBtn}>
            <Download size={13} aria-hidden /> Download {selected ? <Kbd>D</Kbd> : null}
          </a>
          <Button size="sm" icon={<Link2 size={13} />} onClick={() => openShare(path)}>
            Share {selected ? <Kbd>S</Kbd> : null}
          </Button>
          {/* Icon-only so the row fits the 440 px panel on one line. */}
          <IconButton label="Versions" size="sm" onClick={() => openVersions(path)}>
            <History size={14} />
          </IconButton>
          {/* HTML, SVG, XML and JS are always served as a download, so "Open" would only flash a tab. */}
          {!isActiveContent(stat.name || basename(path)) ? (
            <a
              href={contentUrl(ws, path, { at })}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in a new tab"
              title="Open in a new tab"
              className="inline-flex h-7 w-7 items-center justify-center text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-surface-2 hover:text-vx-text-1"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
          ) : null}
        </div>
      ) : stat ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" icon={<Link2 size={13} />} onClick={() => openShare(path)}>
            Share
          </Button>
        </div>
      ) : null}
    </div>
  );

  if (apiErr?.code === 'version_gone') {
    return (
      <div className="flex flex-col">
        {header}
        <EmptyState
          title="This version is no longer kept."
          body={RETENTION_COPY}
          actions={
            timeTravel ? (
              <Button variant="primary" onClick={exitTimeTravel}>
                Back to now
              </Button>
            ) : (
              <Button onClick={closePanel}>Close</Button>
            )
          }
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col">
        {header}
        <PreviewError status={apiErr?.status ?? 500} code={apiErr?.code} onRetry={() => void mutate()} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {header}
      {!stat || isLoading ? (
        <PreviewSkeleton variant={['image', 'pdf', 'video', 'audio', 'none'].includes(rendererFor(name, 0)) ? 'block' : 'lines'} />
      ) : stat.type === 'dir' ? (
        <FolderSummary ws={ws} stat={stat} at={at} />
      ) : (
        <>
          {at ? (
            <div className="flex items-center justify-between gap-3 border-b border-vx-hair-soft bg-vx-past-wash px-4 py-2">
              <span className="vx-micro text-vx-text-3">You are looking at an earlier version.</span>
              <Button size="sm" variant="restore" onClick={() => openRestore({ scope: 'file', path, at })}>
                Restore this version
              </Button>
            </div>
          ) : null}
          <FilePreview
            key={`${path}@${at ?? 'now'}`}
            src={contentUrl(ws, path, { at })}
            downloadHref={contentUrl(ws, path, { at, download: true })}
            name={stat.name}
            size={stat.size}
            version={stat.version}
          />
        </>
      )}
      <div className="flex-1" />
      {stat ? <Details stat={stat} at={at} /> : null}
    </div>
  );
}
