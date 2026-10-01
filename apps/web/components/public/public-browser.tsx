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
            {i > 0 ? <ChevronRight size={14} strokeWidth={1.75} className="shrink-0 text-vx-text-4" aria-hidden /> : null}
            {last ? (
              <span className="truncate px-1.5 text-[18px] font-semibold leading-7 tracking-[-0.015em] text-vx-text-1" aria-current="page">
                {c.label}
              </span>
            ) : (
              <Link
                href={publicShareHref(token, c.rel)}
                className="truncate rounded-vx-sm px-1.5 py-0.5 text-[18px] font-semibold leading-7 tracking-[-0.015em] text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-raise hover:text-vx-text-1"
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
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-vx-sm text-vx-text-2 transition-colors duration-[120ms] ease-vx hover:bg-vx-raise hover:text-vx-text-1';

function PreviewDrawer({ token, entry, onClose, onStep }: { token: string; entry: FileEntry; onClose: () => void; onStep: (dir: 1 | -1) => void }) {
  useHotkeys({ escape: onClose, arrowleft: () => onStep(-1), arrowright: () => onStep(1) });
  const download = publicContentUrl(token, entry.path, { download: true });
  return (
    <aside className="vx-sheet flex min-w-0 flex-col self-start overflow-hidden min-[1000px]:sticky min-[1000px]:top-[72px]" aria-label={`Preview of ${entry.name}`}>
      <div className="flex items-center gap-2.5 pb-3 pl-4 pr-2 pt-3">
        <FileIcon name={entry.name} type="file" size={24} />
        <div className="min-w-0 flex-1">
          <div className="vx-title truncate" title={entry.name}>
            {middleTruncate(entry.name, 48)}
          </div>
          <div className="vx-meta text-vx-text-3">
            {formatBytes(entry.size)} · edited <span title={isoTitle(entry.mtime)}>{formatWhen(entry.mtime)}</span>
          </div>
        </div>
        <a href={download} className={iconLink} aria-label={`Download ${entry.name}`} title="Download">
          <Download size={16} strokeWidth={1.75} aria-hidden />
        </a>
        <IconButton label="Close preview (Esc)" size="sm" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>
      <FilePreview
        key={entry.path}
        src={publicContentUrl(token, entry.path)}
        downloadHref={download}
        name={entry.name}
        size={entry.size}
        className="mx-3 mb-3 overflow-hidden rounded-vx-sm border border-vx-hair bg-vx-surface-2"
      />
    </aside>
  );
}

const cols = 'grid-cols-[20px_minmax(0,1fr)_140px_88px_64px] max-[640px]:grid-cols-[20px_minmax(0,1fr)_64px]';

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
      <section className="vx-sheet min-w-0 overflow-hidden">
        {/* The folder's name is the page title already: crumbs appear only inside a subfolder. */}
        {rel !== '/' ? (
          <div className="flex h-[52px] items-center gap-3 border-b border-vx-hair pl-2.5 pr-4">
            <Crumbs token={token} rootName={meta.name} rel={rel} />
          </div>
        ) : null}
        <div className={cx('vx-colhead grid h-9 items-center gap-3 border-b border-vx-hair px-4', cols)}>
          <span />
          <span>Name</span>
          <span className="max-[640px]:hidden">Modified</span>
          <span className="text-right max-[640px]:hidden">Size</span>
          <span className="whitespace-nowrap text-right normal-case tracking-normal">
            {data ? `${entries.length} ${entries.length === 1 ? 'item' : 'items'}` : null}
          </span>
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
          <EmptyState art="folder" title="This folder is empty." body="Nothing has been added here yet." />
        ) : (
          <ul role="list">
            {entries.map((e) => {
              const active = preview?.path === e.path;
              const dl = e.type === 'dir' ? publicZipUrl(token, e.path) : publicContentUrl(token, e.path, { download: true });
              return (
                <li
                  key={e.path}
                  className={cx(
                    'group grid h-9 cursor-default items-center gap-3 border-b border-vx-hair-soft px-4 transition-colors duration-[120ms] last:border-b-0 max-[640px]:h-14',
                    cols,
                    active ? 'vx-selected' : 'hover:bg-vx-raise',
                  )}
                >
                  <FileIcon name={e.name} type={e.type} size={20} />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => open(e)}
                      className={cx('vx-inset-focus block max-w-full truncate rounded-vx-xs text-left text-[14px] font-medium leading-5 max-[640px]:text-[15px]', active ? 'text-vx-on-selection' : 'text-vx-text-1')}
                      title={e.name}
                    >
                      {middleTruncate(e.name, 64)}
                    </button>
                    <div className="vx-meta mt-0.5 hidden truncate text-vx-text-3 max-[640px]:block">
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
                    className={cx(iconLink, 'justify-self-end opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-[640px]:opacity-100 [@media(hover:none)]:opacity-100')}
                  >
                    {e.type === 'dir' ? <FolderDown size={16} strokeWidth={1.75} aria-hidden /> : <Download size={16} strokeWidth={1.75} aria-hidden />}
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
