'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Share2 } from 'lucide-react';
import { RETENTION_COPY, basename, dirname, formatBytes, isActiveContent, mimeFor, previewKind, shortId, type FileStat } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useStat } from '@/lib/api/hooks';
import { formatDate, formatTimeTravelLabel, isoTitle } from '@/lib/format';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { contentUrl, zipUrl } from '@/lib/urls';
import { FilePreview, rendererFor } from './file-preview';
import { compareEntries, formatWhen, kindLabel, middleTruncate, stepSibling } from './names';
import { PreviewError, PreviewSkeleton } from './states';

const noRetry = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

/** Commit time for the "As of" badge (from the time-travel state when it matches, else the commit). */
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
    ['Path', <span key="p" className="break-all">{stat.path}</span>],
    [
      'Size',
      stat.type === 'dir' ? '—' : (
        <span key="s">
          {formatBytes(stat.size)} <span className="text-vx-text-3">· {stat.size.toLocaleString('en-US')} bytes</span>
        </span>
      ),
    ],
    ['Type', stat.type === 'dir' ? 'Folder' : mimeFor(stat.name).split(';')[0]],
    ['Modified', <span key="m" title={isoTitle(stat.mtime)}>{formatDate(stat.mtime)}</span>],
    [
      'Version',
      stat.version ? (
        <span key="v" className="font-mono text-[12px]" title={stat.version}>
          {shortId('vc_' + stat.version)}
        </span>
      ) : (
        '—'
      ),
    ],
    [
      'Read at',
      <span key="c" title={stat.commitId}>
        {at ? null : 'Now · '}
        <span className="font-mono text-[12px]">{shortId(stat.commitId)}</span>
      </span>,
    ],
  ];
  return (
    <div className="mx-3 border-t border-vx-hair-soft">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 flex h-10 w-full items-center gap-2 rounded-vx-sm px-2 text-left text-[14px] font-semibold text-vx-text-1 transition-colors duration-[120ms] hover:bg-vx-hover"
      >
        Details
        <ChevronDown size={16} strokeWidth={1.75} className={cx('text-vx-text-3 transition-transform duration-[120ms]', open ? '' : '-rotate-90')} aria-hidden />
      </button>
      {open ? (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 pb-4 pt-1 text-[13px] leading-5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-vx-text-3">{k}</dt>
              <dd className="min-w-0 tabular-nums text-vx-text-1">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function FolderSummary({ ws, stat, at }: { ws: string; stat: FileStat; at: string | null }) {
  const openRestore = useVx((s) => s.openRestore);
  const { data, error } = useSWR(['ls', ws, stat.path, at], () => api.files.list(ws, { path: stat.path, at }), { ...noRetry, keepPreviousData: true });
  const files = data?.entries.filter((e) => e.type !== 'dir').length ?? 0;
  const dirs = data?.entries.filter((e) => e.type === 'dir').length ?? 0;
  const newest = data?.entries.reduce((m, e) => Math.max(m, e.mtime), 0) ?? 0;
  return (
    <div className="mx-3 mb-3 rounded-vx-md bg-vx-surface-2 px-4 py-5">
      {error ? (
        <PreviewError status={error instanceof ApiError ? error.status : 500} code={error instanceof ApiError ? error.code : undefined} />
      ) : !data ? (
        <PreviewSkeleton className="px-0 py-0" />
      ) : (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px] leading-5">
          <dt className="text-vx-text-3">Items</dt>
          <dd className="tabular-nums text-vx-text-1">
            {data.entries.length} <span className="text-vx-text-3">· {files} {files === 1 ? 'file' : 'files'}, {dirs} {dirs === 1 ? 'folder' : 'folders'}</span>
          </dd>
          <dt className="text-vx-text-3">Last change</dt>
          <dd className="text-vx-text-1" title={newest ? isoTitle(newest) : undefined}>
            {newest ? formatWhen(newest) : '—'}
          </dd>
        </dl>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <a href={zipUrl(ws, [stat.path], at)} className={buttonClass('outline', 'sm', { withIcon: true })}>
          <Download size={16} strokeWidth={1.75} aria-hidden /> Download .zip
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

/** Icon-only link styled as a 32 px icon button. */
const iconLink =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-vx-text-2 transition-colors duration-[120ms] ease-vx hover:bg-vx-surface-3 hover:text-vx-text-1 active:bg-vx-pressed';

/** The preview tab of the right-hand panel (`panel.kind === 'preview'`). */
export default function PreviewPanel() {
  const panel = useVx((s) => s.panel);
  const ws = useVx((s) => s.workspaceId);
  const selection = useVx((s) => s.selection);
  const timeTravel = useVx((s) => s.timeTravel);
  const { openPreview, openShare, openRestore, closePanel, select, exitTimeTravel } = useVx.getState();

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

  const kind = stat ? (stat.type === 'dir' ? 'Folder' : kindLabel(stat.name, previewKind(stat.name))) : null;
  const header = (
    <div className="pb-3 pl-5 pr-3 pt-4">
      <div className="flex items-center gap-3">
        <FileIcon name={name} type={stat?.type === 'dir' ? 'dir' : 'file'} size={32} />
        <h2 className="vx-title min-w-0 flex-1 truncate" title={path}>
          {middleTruncate(name, 40)}
        </h2>
        {stat ? (
          <div className="flex shrink-0 items-center">
            {stat.type !== 'dir' ? (
              <Tooltip label="Download" kbd={selected ? 'D' : undefined}>
                <a href={contentUrl(ws, path, { at, download: true })} className={iconLink} aria-label="Download">
                  <Download size={18} strokeWidth={1.75} aria-hidden />
                </a>
              </Tooltip>
            ) : null}
            <Tooltip label="Share" kbd={selected ? 'S' : undefined}>
              <IconButton label="Share" nativeTitle={false} size="sm" onClick={() => openShare(path)}>
                <Share2 size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
            {/* HTML, SVG, XML and JS are always served as a download, so "Open" would only flash a tab. */}
            {stat.type !== 'dir' && !isActiveContent(stat.name || basename(path)) ? (
              <Tooltip label="Open in a new tab">
                <a href={contentUrl(ws, path, { at })} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" className={iconLink}>
                  <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
                </a>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex min-h-7 items-center gap-2">
        <div className="vx-meta flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-vx-text-3">
          {stat ? (
            <>
              <span className="min-w-0 truncate">
                {kind}
                {stat.type === 'dir' ? null : <> · {formatBytes(stat.size)}</>} · edited{' '}
                <span title={isoTitle(stat.mtime)}>{formatWhen(stat.mtime)}</span>
              </span>
              {at ? (
                <Badge tone="past" icon={<Clock strokeWidth={2} aria-hidden />} title={asOf ? isoTitle(asOf) : at}>
                  As of {asOf ? formatTimeTravelLabel(asOf) : '…'}
                </Badge>
              ) : null}
            </>
          ) : (
            <span className="skeleton skel-line inline-block w-40" />
          )}
        </div>
        {siblings.length > 1 ? (
          <div className="-mr-1 flex shrink-0 items-center">
            <IconButton label="Previous file (←)" size="xs" disabled={!prev} onClick={() => go(prev)}>
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
            </IconButton>
            <IconButton label="Next file (→)" size="xs" disabled={!next} onClick={() => go(next)}>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </div>
        ) : null}
      </div>
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
        <div className="mx-3 mb-3 overflow-hidden rounded-vx-md bg-vx-surface-2">
          <PreviewSkeleton variant={['image', 'pdf', 'video', 'audio', 'none'].includes(rendererFor(name, 0)) ? 'block' : 'lines'} />
        </div>
      ) : stat.type === 'dir' ? (
        <FolderSummary ws={ws} stat={stat} at={at} />
      ) : (
        <>
          {at ? (
            <div className="px-3 pb-3">
              <Button variant="restore" block onClick={() => openRestore({ scope: 'file', path, at })}>
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
            className="mx-3 mb-3 overflow-hidden rounded-vx-md bg-vx-surface-2"
          />
        </>
      )}
      <div className="flex-1" />
      {stat ? <Details stat={stat} at={at} /> : null}
    </div>
  );
}
