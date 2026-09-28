'use client';

import { Download, Pin } from 'lucide-react';
import { formatBytes, type PublicShareMeta } from '@volumes/shared';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatTimeTravelLabel, isoTitle } from '@/lib/format';

/** `Live` or `Pinned · 14 Sep 16:40`: always a neutral badge (visitors are not "in the past"). */
export function ModeChip({ meta }: { meta: Pick<PublicShareMeta, 'mode' | 'pinnedAt'> }) {
  if (meta.mode === 'live') {
    return (
      <Badge pip title="Always shows the latest version">
        Live
      </Badge>
    );
  }
  return (
    <Badge icon={<Pin strokeWidth={2} aria-hidden />} title={meta.pinnedAt ? `Shows the version from ${isoTitle(meta.pinnedAt)}` : 'Shows one saved version'}>
      Pinned{meta.pinnedAt ? ` · ${formatTimeTravelLabel(meta.pinnedAt).replace(',', '')}` : ''}
    </Badge>
  );
}

/** The public page frame (DESIGN-v2 §6.12): a 64 px top bar (brand, item name, mode badge, Download), content, footer with the theme button. */
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
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 bg-vx-bg px-4 min-[720px]:px-6">
        <Brand href={null} className="shrink-0 max-[520px]:[&>span:last-child]:hidden" />
        {meta ? (
          <>
            <span aria-hidden className="h-6 w-px shrink-0 bg-vx-hair" />
            <span className="min-w-0 truncate text-[16px] font-semibold leading-6 text-vx-text-1" title={meta.name}>
              {meta.name}
            </span>
            <span className="shrink-0 max-[400px]:hidden">
              <ModeChip meta={meta} />
            </span>
          </>
        ) : null}
        <span className="flex-1" />
        {download ? (
          <a href={download.href} className={buttonClass('primary', 'md', { withIcon: true, className: 'max-[520px]:w-9 max-[520px]:px-0' })} aria-label={download.label}>
            <Download size={18} strokeWidth={1.75} aria-hidden />
            <span className="max-[520px]:hidden">{download.label}</span>
          </a>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 pb-10 pt-8 min-[720px]:px-6">{children}</main>
      <footer className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-4 min-[720px]:px-6">
        <span className="vx-micro text-vx-text-3">Shared with Volumes. Every change is a version.</span>
        <ThemeToggle size="sm" />
      </footer>
    </div>
  );
}

/** The hero: eyebrow, the name as a display heading, who shared it, size, version and expiry. */
export function PublicHero({ meta }: { meta: PublicShareMeta }) {
  const facts: React.ReactNode[] = [meta.ownerName ? `Shared by ${meta.ownerName}` : 'Shared with you'];
  if (meta.targetType === 'file' && typeof meta.size === 'number') facts.push(formatBytes(meta.size));
  facts.push(
    meta.mode === 'pinned' && meta.pinnedAt ? (
      <span key="v" title={isoTitle(meta.pinnedAt)}>
        as it was on {formatTimeTravelLabel(meta.pinnedAt)}
      </span>
    ) : (
      'always the latest version'
    ),
  );
  if (meta.expiresAt) {
    facts.push(
      <span key="e" title={isoTitle(meta.expiresAt)}>
        link expires {formatDate(meta.expiresAt)}
      </span>,
    );
  }
  return (
    <div className="mb-6">
      <div className="vx-eyebrow">{meta.targetType === 'dir' ? 'Shared folder' : 'Shared file'}</div>
      <h1 className="vx-display mt-2 break-words">{meta.name}</h1>
      <p className="vx-body mt-2 text-vx-text-3">
        {facts.map((f, i) => (
          <span key={i}>
            {i > 0 ? ' · ' : null}
            {f}
          </span>
        ))}
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
