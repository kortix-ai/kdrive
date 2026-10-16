'use client';

// Upload link page: no sign-in, no app chrome. `/u/<token>`: people send files into a folder.
// A link with access controls shows its gate first (password, sign-in, wrong account).
import { useEffect } from 'react';
import { useParams, usePathname } from 'next/navigation';
import useSWR from 'swr';
import { PublicGate, gateFor } from '@/components/public/public-gate';
import { PublicShell, inactiveCopy } from '@/components/public/public-shell';
import { UploadDrop } from '@/components/public/upload-drop';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatDate, isoTitle } from '@/lib/format';

export default function UploadLinkPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(params.token) ? params.token : '';

  // One meta fetch per visit (it counts an open).
  const pathname = usePathname();
  const { data: meta, error, isLoading, mutate } = useSWR(token ? ['public-upload-meta', token] : null, () => api.public.uploadMeta(token), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    document.title = meta ? `Send files · ${meta.name} · KDRIVE` : 'Send files · KDRIVE';
  }, [meta]);

  const gate = gateFor(error);
  if (gate && token) {
    return (
      <PublicShell>
        <PublicGate gate={gate} token={token} kind="upload" next={pathname || `/u/${token}`} onUnlocked={() => void mutate()} />
      </PublicShell>
    );
  }

  if (error || (!token && !isLoading)) {
    const copy = inactiveCopy(error ?? new ApiError(404, 'not_found', 'Not found'));
    return (
      <PublicShell>
        <div className="flex flex-1 items-center justify-center">
          <EmptyState art="gone" tone="past" title={copy.title} body={copy.body} />
        </div>
      </PublicShell>
    );
  }

  if (!meta) {
    return (
      <PublicShell>
        <div aria-busy className="flex flex-col gap-3">
          <span className="skeleton skel-line w-24" />
          <span className="skeleton block h-11 w-2/3" />
          <span className="skeleton skel-line w-48" />
          <span className="skeleton mt-6 block h-[220px] w-full max-w-[720px] !rounded-vx-lg" />
        </div>
      </PublicShell>
    );
  }

  const facts: React.ReactNode[] = [`Into the folder “${meta.name}”`];
  if (meta.remainingFiles !== null) facts.push(`${meta.remainingFiles} ${meta.remainingFiles === 1 ? 'file' : 'files'} left`);
  if (meta.expiresAt) {
    facts.push(
      <span key="e" title={isoTitle(meta.expiresAt)}>
        link expires {formatDate(meta.expiresAt)}
      </span>,
    );
  }

  return (
    <PublicShell>
      <div className="mb-8 max-[720px]:mb-6">
        <div className="vx-eyebrow">Upload link</div>
        <h1 className="vx-display mt-3 break-words">Send files to {meta.ownerName ?? 'the owner'}</h1>
        <p className="vx-meta mt-3 text-vx-text-3">
          {facts.map((f, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : null}
              {f}
            </span>
          ))}
        </p>
      </div>
      {meta.remainingFiles === 0 ? (
        <EmptyState art="links" title="This link has received all the files it accepts." body="Ask the person who sent it for a new link." />
      ) : (
        <UploadDrop token={token} meta={meta} />
      )}
    </PublicShell>
  );
}
