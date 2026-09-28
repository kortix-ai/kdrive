'use client';

import { Download } from 'lucide-react';
import type { PublicShareMeta } from '@volumes/shared';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { cx } from '@/components/ui/cx';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatTimeTravelLabel, isoTitle } from '@/lib/format';

/** Platinum square mark in currentColor. */
export function Mark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="currentColor" />
      <rect x="4" y="4" width="8" height="8" fill="currentColor" />
    </svg>
  );
}

/** Dashed stencil slab (Platinum's 404 idiom): the inactive-link empty state. */
export function StencilArt() {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" aria-hidden className="mb-6">
      <path d="M60 16 L100 36 L60 56 L20 36 Z" fill="none" stroke="var(--ea-line)" strokeDasharray="3 3" />
      <path d="M20 36 L60 56 L60 70 L20 50 Z" fill="none" stroke="var(--ea-line-dim)" strokeDasharray="3 3" />
      <path d="M60 56 L100 36 L100 50 L60 70 Z" fill="none" stroke="var(--ea-line-dim)" strokeDasharray="3 3" />
      <rect x="57" y="33" width="6" height="6" fill="none" stroke="var(--ea-accent)" transform="rotate(45 60 36)" />
      <ellipse cx="60" cy="86" rx="30" ry="3" fill="var(--ea-shadow)" opacity="0.18" />
    </svg>
  );
}

/** `LIVE` (purple pip) or `PINNED 14 SEP 16:40`: neutral hairline chip (visitors are not "in the past"). */
export function ModeChip({ meta }: { meta: Pick<PublicShareMeta, 'mode' | 'pinnedAt'> }) {
  return (
    <span
      className="vx-label inline-flex h-6 shrink-0 items-center gap-1.5 border border-vx-hair-strong px-2 text-[9.5px] text-vx-text-2"
      title={meta.mode === 'pinned' && meta.pinnedAt ? `Shows the version from ${isoTitle(meta.pinnedAt)}` : 'Always shows the latest version'}
    >
      {meta.mode === 'live' ? (
        <>
          <span aria-hidden className="inline-block h-1 w-1 bg-vx-accent" /> Live
        </>
      ) : (
        <>Pinned {meta.pinnedAt ? formatTimeTravelLabel(meta.pinnedAt).replace(',', '') : ''}</>
      )}
    </span>
  );
}

/** The public page frame: 48 px top bar (mark, item name, mode chip, download), content, footer, theme toggle. */
export function PublicShell({
  meta,
  download,
  children,
}: {
  meta?: PublicShareMeta | null;
  download?: { href: string; label: string } | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-auto bg-vx-bg">
      <meta name="robots" content="noindex, nofollow" />
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-vx-hair bg-vx-bg px-4">
        <span className="flex items-center gap-2.5 text-vx-text-1">
          <Mark />
          <span className="vx-label text-vx-text-1">Volumes</span>
        </span>
        {meta ? (
          <>
            <span aria-hidden className="h-4 w-px bg-vx-hair" />
            <span className="vx-ui min-w-0 truncate text-vx-text-1" title={meta.name}>
              {meta.name}
              {meta.targetType === 'dir' ? '/' : ''}
            </span>
            <ModeChip meta={meta} />
          </>
        ) : null}
        <span className="flex-1" />
        {download ? (
          <a
            href={download.href}
            className="inline-flex h-8 shrink-0 items-center gap-2 bg-pt-100 px-3 font-mono text-[12px] font-medium text-vx-text-inv hover:brightness-110"
          >
            <Download size={14} aria-hidden /> {download.label}
          </a>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 py-8 min-[720px]:px-8">{children}</main>
      <footer className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-vx-hair px-4">
        <span className="vx-micro text-vx-text-4">Shared with Volumes. Every change is a version.</span>
        <ThemeToggle />
      </footer>
    </div>
  );
}

/** The hero: SHARED FILE / FOLDER, the name in brushed metal, who shared it, expiry. */
export function PublicHero({ meta }: { meta: PublicShareMeta }) {
  return (
    <div className="mb-6">
      <div className="vx-label">{meta.targetType === 'dir' ? 'Shared folder' : 'Shared file'}</div>
      <h1 className={cx('vx-display vx-metal mt-2 break-words')}>{meta.name}</h1>
      <p className="vx-meta mt-2 text-vx-text-3">
        {meta.ownerName ? <>Shared by {meta.ownerName}</> : 'Shared with you'}
        {meta.mode === 'pinned' && meta.pinnedAt ? (
          <>
            {' '}
            · <span title={isoTitle(meta.pinnedAt)}>as it was on {formatTimeTravelLabel(meta.pinnedAt)}</span>
          </>
        ) : (
          <> · always the latest version</>
        )}
        {meta.expiresAt ? (
          <>
            {' '}
            · <span title={isoTitle(meta.expiresAt)}>link expires {formatDate(meta.expiresAt)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export default PublicShell;

/** Copy for a link that cannot be opened. */
export function inactiveCopy(err: unknown): { title: string; body: string } {
  const e = err instanceof ApiError ? err : null;
  if (e?.code === 'link_expired') return { title: 'This link has expired.', body: 'Ask the person who shared it for a new link.' };
  if (e?.code === 'link_revoked') return { title: 'This link is no longer active.', body: 'The owner turned it off. Ask them for a new link.' };
  if (e?.status === 429 || e?.code === 'rate_limited') return { title: 'Too many opens. Try again in a minute.', body: 'This link was opened a lot in a short time.' };
  if (e?.status === 404) return { title: 'This link is no longer active.', body: 'Check the address, or ask the person who shared it for a new link.' };
  return { title: "Couldn't open this link.", body: 'Something went wrong on our side. Try again in a moment.' };
}
