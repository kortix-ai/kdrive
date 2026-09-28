'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Download, FolderDown, X } from 'lucide-react';
import { formatBytes, splitPath, type FileEntry, type PublicShareMeta } from '@volumes/shared';
import { FilePreview } from '@/components/preview/file-preview';
import { compareEntries, middleTruncate } from '@/components/preview/names';
import { PreviewError } from '@/components/preview/states';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatRelative, isoTitle } from '@/lib/format';
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
    <nav aria-label="Folder" className="vx-ui flex min-w-0 items-center gap-1.5 overflow-hidden">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.rel} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <span className="text-vx-text-4">/</span> : null}
            {last ? (
              <span className="truncate text-vx-text-1" aria-current="page">
                {c.label}
              </span>
            ) : (
              <Link href={publicShareHref(token, c.rel)} className="truncate text-vx-text-3 hover:text-vx-text-1">
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function PreviewDrawer({ token, entry, onClose, onStep }: { token: string; entry: FileEntry; onClose: () => void; onStep: (dir: 1 | -1) => void }) {
  useHotkeys({ escape: onClose, arrowleft: () => onStep(-1), arrowright: () => onStep(1) });
  const download = publicContentUrl(token, entry.path, { download: true });
  return (
    <aside className="flex min-w-0 flex-col border border-vx-hair bg-vx-surface" aria-label={`Preview of ${entry.name}`}>
      <div className="flex h-12 items-center gap-2 border-b border-vx-hair pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <div className="vx-title truncate text-[14px]" title={entry.name}>
            {middleTruncate(entry.name, 48)}
          </div>
        </div>
        <span className="vx-meta shrink-0 text-vx-text-3">{formatBytes(entry.size)}</span>
        <a href={download} className="inline-flex h-7 items-center gap-1.5 border border-vx-hair px-2.5 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1">
          <Download size={13} aria-hidden /> Download
        </a>
        <IconButton label="Close preview (Esc)" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <FilePreview key={entry.path} src={publicContentUrl(token, entry.path)} downloadHref={download} name={entry.name} size={entry.size} />
    </aside>
  );
}

/** Read-only folder browser for a shared folder: breadcrumbs clamped to the link root, list, preview drawer, per-row download. */
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
    <div className={cx('grid min-w-0 gap-4', preview ? 'min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,560px)]' : 'grid-cols-1')}>
      <section className="min-w-0 border border-vx-hair">
        <div className="flex h-10 items-center gap-3 border-b border-vx-hair px-3">
          <Crumbs token={token} rootName={meta.name} rel={rel} />
          <span className="flex-1" />
          {data ? <span className="vx-meta shrink-0 text-vx-text-4">{entries.length} items</span> : null}
        </div>
        <div className="grid h-8 grid-cols-[20px_minmax(0,1fr)_112px_88px_28px] items-center gap-3 border-b border-vx-hair bg-vx-surface-2 px-3 max-[640px]:grid-cols-[20px_minmax(0,1fr)_88px_28px]">
          <span />
          <span className="vx-label">Name</span>
          <span className="vx-label text-right max-[640px]:hidden">Modified</span>
          <span className="vx-label text-right">Size</span>
          <span />
        </div>
        {apiErr ? (
          <PreviewError status={apiErr.status} code={apiErr.code} onRetry={() => void mutate()} />
        ) : isLoading && !data ? (
          <div className="px-3 py-3">
            {[60, 44, 52, 38].map((w, i) => (
              <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title="This folder is empty." body="Nothing has been added here yet." />
        ) : (
          <ul role="list">
            {entries.map((e) => {
              const active = preview?.path === e.path;
              return (
                <li
                  key={e.path}
                  className={cx(
                    'grid h-9 cursor-default grid-cols-[20px_minmax(0,1fr)_112px_88px_28px] items-center gap-3 border-b border-vx-hair-soft px-3 last:border-b-0 hover:bg-vx-surface-2 max-[640px]:grid-cols-[20px_minmax(0,1fr)_88px_28px]',
                    active && 'bg-vx-accent-wash shadow-[inset_2px_0_0_var(--vx-accent-edge)]',
                  )}
                >
                  <FileIcon name={e.name} type={e.type} />
                  <button
                    type="button"
                    onClick={() => open(e)}
                    className="vx-name vx-inset-focus min-w-0 truncate text-left text-vx-text-1 hover:underline hover:decoration-vx-hair-strong hover:underline-offset-4"
                    title={e.name}
                  >
                    {middleTruncate(e.name, 64)}
                  </button>
                  <span className="vx-meta text-right text-vx-text-3 max-[640px]:hidden" title={isoTitle(e.mtime)}>
                    {formatRelative(e.mtime)}
                  </span>
                  <span className="vx-meta text-right text-vx-text-3">{e.type === 'dir' ? '—' : formatBytes(e.size)}</span>
                  <a
                    href={e.type === 'dir' ? publicZipUrl(token, e.path) : publicContentUrl(token, e.path, { download: true })}
                    aria-label={e.type === 'dir' ? `Download ${e.name} as .zip` : `Download ${e.name}`}
                    title={e.type === 'dir' ? 'Download .zip' : 'Download'}
                    className="inline-flex h-7 w-7 items-center justify-center text-vx-text-3 hover:bg-vx-surface-3 hover:text-vx-text-1"
                  >
                    {e.type === 'dir' ? <FolderDown size={14} /> : <Download size={14} />}
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
