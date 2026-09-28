'use client';

// Public share page: no sign-in, no app chrome. `/s/<token>` (+ a folder path relative to the link root).
import { useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { decodePathFromUrl } from '@volumes/shared';
import { FilePreview } from '@/components/preview/file-preview';
import { PublicBrowser } from '@/components/public/public-browser';
import { PublicHero, PublicShell, StencilArt, inactiveCopy } from '@/components/public/public-shell';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { publicContentUrl, publicZipUrl } from '@/lib/urls';

export default function PublicSharePage() {
  const params = useParams<{ token: string; path?: string[] | string }>();
  const token = typeof params.token === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(params.token) ? params.token : '';
  const rawPath = params.path;
  const rel = useMemo(() => {
    try {
      return decodePathFromUrl(rawPath);
    } catch {
      return '/';
    }
  }, [Array.isArray(rawPath) ? rawPath.join('/') : rawPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // One meta fetch per visit (it counts an open); client-side folder navigation reuses it.
  const { data: meta, error, isLoading } = useSWR(token ? ['public-meta', token] : null, () => api.public.meta(token), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    document.title = meta ? `${meta.name} · Volumes` : 'Shared link · Volumes';
  }, [meta]);

  if (error || (!token && !isLoading)) {
    const copy = inactiveCopy(error ?? new ApiError(404, 'not_found', 'Not found'));
    return (
      <PublicShell>
        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <StencilArt />
          <div className="vx-title">{copy.title}</div>
          <p className="vx-body mt-2 max-w-[420px] text-vx-text-3">{copy.body}</p>
        </div>
      </PublicShell>
    );
  }

  if (!meta) {
    return (
      <PublicShell>
        <div aria-busy className="flex flex-col gap-3">
          <span className="skeleton skel-line w-24" />
          <span className="skeleton block h-10 w-2/3" />
          <span className="skeleton skel-line w-48" />
          <span className="skeleton mt-6 block h-[50vh] w-full" />
        </div>
      </PublicShell>
    );
  }

  const isDir = meta.targetType === 'dir';
  const download = isDir
    ? { href: publicZipUrl(token, rel), label: 'Download .zip' }
    : { href: publicContentUrl(token, '/', { download: true }), label: 'Download' };

  return (
    <PublicShell meta={meta} download={download}>
      <PublicHero meta={meta} />
      {isDir ? (
        <PublicBrowser token={token} meta={meta} rel={rel} />
      ) : (
        <div className="border border-vx-hair bg-vx-surface">
          <FilePreview
            src={publicContentUrl(token, '/')}
            downloadHref={publicContentUrl(token, '/', { download: true })}
            name={meta.name}
            size={meta.size ?? 0}
            mime={meta.mime}
          />
        </div>
      )}
    </PublicShell>
  );
}
