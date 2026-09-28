'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ChevronRight, Download, FolderDown, X } from 'lucide-react';
import { formatBytes, splitPath, type FileEntry, type PublicShareMeta } from '@volumes/shared';
import { FilePreview } from '@/components/preview/file-preview';
import { compareEntries, formatWhen, middleTruncate } from '@/components/preview/names';
import { PreviewError } from '@/components/preview/states';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { useHotkeys } from '@/lib/keys';
import { publicContentUrl, publicShareHref, publicZipUrl } from '@/lib/urls';

/** Breadcrumbs for `rel` (relative to the link root); the first crumb is the shared folder itself. */
export function publicCrumbs(rootName: string, rel: string): { label: string; rel: string }[] {
  const segs = splitPath(rel);
  return [{ label: rootName, rel: '/' }, ...segs.map((s, i) => ({ label: s, rel: '/' + segs.slice(0, i + 1).join('/') }))];
}

function Crumbs({ token, rootName, rel }: { token: string; rootName: string; rel: string }) {
  const crumbs = publicCrumbs(rootName, rel);
  return (
    <nav aria-label="Folder" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.rel} className={cx('flex items-center gap-0.5', last ? 'min-w-0' : 'min-w-0 shrink max-[520px]:hidden')}>
            {i > 0 ? <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-vx-text-4" aria-hidden /> : null}
            {last ? (
              <span className="truncate px-2 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-vx-text-1" aria-current="page">
                {c.label}
              </span>
            ) : (
              <Link
                href={publicShareHref(token, c.rel)}
                className="truncate rounded-full px-2 py-1 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-hover hover:text-vx-text-1"
              >
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

const iconLink =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-vx-text-2 transition-colors duration-[120ms] ease-vx hover:bg-vx-surface-3 hover:text-vx-text-1';

function PreviewDrawer({ token, entry, onClose, onStep }: { token: string; entry: FileEntry; onClose: () => void; onStep: (dir: 1 | -1) => void }) {
  useHotkeys({ escape: onClose, arrowleft: () => onStep(-1), arrowright: () => onStep(1) });
  const download = publicContentUrl(token, entry.path, { download: true });
  return (
    <aside className="vx-sheet flex min-w-0 flex-col self-start overflow-hidden min-[1000px]:sticky min-[1000px]:top-20" aria-label={`Preview of ${entry.name}`}>
      <div className="flex items-center gap-3 pb-3 pl-5 pr-2 pt-4">
        <FileIcon name={entry.name} type="file" size={32} />
        <div className="min-w-0 flex-1">
          <div className="vx-title truncate" title={entry.name}>
            {middleTruncate(entry.name, 48)}
          </div>
          <div className="vx-meta text-vx-text-3">
            {formatBytes(entry.size)} · edited <span title={isoTitle(entry.mtime)}>{formatWhen(entry.mtime)}</span>
          </div>
        </div>
        <a href={download} className={iconLink} aria-label={`Download ${entry.name}`} title="Download">
          <Download size={18} strokeWidth={1.75} aria-hidden />
        </a>
        <IconButton label="Close preview (Esc)" onClick={onClose}>
          <X size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>
      <FilePreview
        key={entry.path}
        src={publicContentUrl(token, entry.path)}
        downloadHref={download}
        name={entry.name}
        size={entry.size}
        className="mx-3 mb-3 overflow-hidden rounded-vx-md bg-vx-surface-2"
      />
    </aside>
  );
}

const cols = 'grid-cols-[24px_minmax(0,1fr)_120px_88px_32px] max-[640px]:grid-cols-[24px_minmax(0,1fr)_32px]';

/** Read-only folder browser for a shared folder: breadcrumbs clamped to the link root, list, preview sheet, per-row download. */
export function PublicBrowser({ token, meta, rel }: { token: string; meta: PublicShareMeta; rel: string }) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR(['public-ls', token, rel], () => api.public.list(token, { path: rel }), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
  });
  const [preview, setPreview] = useState<FileEntry | null>(null);
  useEffect(() => setPreview(null), [rel]);

  const entries = useMemo(() => (data ? [...data.entries].sort(compareEntries) : []), [data]);
  const files = useMemo(() => entries.filter((e) => e.type === 'file'), [entries]);
  const step = (dir: 1 | -1) => {
    if (!preview) return;
    const i = files.findIndex((f) => f.path === preview.path);
    const next = files[i + dir];
    if (next) setPreview(next);
  };

  const open = (e: FileEntry) => {
    if (e.type === 'dir') router.push(publicShareHref(token, e.path));
    else if (e.type === 'file') setPreview(e);
  };

  const apiErr = error instanceof ApiError ? error : null;

  return (
    <div className={cx('grid min-w-0 items-start gap-2', preview ? 'min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,480px)]' : 'grid-cols-1')}>
      <section className="vx-sheet min-w-0 overflow-hidden pb-2">
        <div className="flex h-16 items-center gap-3 pl-3 pr-5">
          <Crumbs token={token} rootName={meta.name} rel={rel} />
          <span className="flex-1" />
          {data ? (
            <span className="vx-meta shrink-0 text-vx-text-3">
              {entries.length} {entries.length === 1 ? 'item' : 'items'}
            </span>
          ) : null}
        </div>
        <div className={cx('mx-2 grid h-11 items-center gap-3 border-b border-vx-hair px-3 text-[13px] font-medium leading-5 text-vx-text-3', cols)}>
          <span />
          <span>Name</span>
          <span className="max-[640px]:hidden">Modified</span>
          <span className="text-right max-[640px]:hidden">Size</span>
          <span />
        </div>
        {apiErr ? (
          <PreviewError status={apiErr.status} code={apiErr.code} onRetry={() => void mutate()} />
        ) : isLoading && !data ? (
          <div className="px-5 py-4">
            {[60, 44, 52, 38].map((w, i) => (
              <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title="This folder is empty." body="Nothing has been added here yet." />
        ) : (
          <ul role="list" className="px-2 pt-1">
            {entries.map((e) => {
              const active = preview?.path === e.path;
              const dl = e.type === 'dir' ? publicZipUrl(token, e.path) : publicContentUrl(token, e.path, { download: true });
              return (
                <li
                  key={e.path}
                  className={cx(
                    'group grid h-10 cursor-default items-center gap-3 rounded-vx-sm px-3 transition-colors duration-[120ms] max-[640px]:h-[60px]',
                    cols,
                    active ? 'bg-vx-selection text-vx-on-selection' : 'hover:bg-vx-hover',
                  )}
                >
                  <FileIcon name={e.name} type={e.type} size={24} />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => open(e)}
                      className={cx('vx-inset-focus block max-w-full truncate rounded-vx-xs text-left text-[14px] font-medium leading-5 max-[640px]:text-[15px]', active ? 'text-vx-on-selection' : 'text-vx-text-1')}
                      title={e.name}
                    >
                      {middleTruncate(e.name, 64)}
                    </button>
                    <div className="vx-meta hidden truncate text-vx-text-3 max-[640px]:block">
                      Modified {formatWhen(e.mtime)}
                      {e.type === 'dir' ? null : <> · {formatBytes(e.size)}</>}
                    </div>
                  </div>
                  <span className={cx('vx-meta-row truncate max-[640px]:hidden', active ? 'text-vx-on-selection' : 'text-vx-text-3')} title={isoTitle(e.mtime)}>
                    {formatWhen(e.mtime)}
                  </span>
                  <span className={cx('vx-meta-row text-right max-[640px]:hidden', active ? 'text-vx-on-selection' : 'text-vx-text-3')}>
                    {e.type === 'dir' ? '—' : formatBytes(e.size)}
                  </span>
                  <a
                    href={dl}
                    aria-label={e.type === 'dir' ? `Download ${e.name} as .zip` : `Download ${e.name}`}
                    title={e.type === 'dir' ? 'Download .zip' : 'Download'}
                    className={cx(iconLink, 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-[640px]:opacity-100 [@media(hover:none)]:opacity-100')}
                  >
                    {e.type === 'dir' ? <FolderDown size={18} strokeWidth={1.75} aria-hidden /> : <Download size={18} strokeWidth={1.75} aria-hidden />}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {preview ? <PreviewDrawer token={token} entry={preview} onClose={() => setPreview(null)} onStep={step} /> : null}
    </div>
  );
}

export default PublicBrowser;
