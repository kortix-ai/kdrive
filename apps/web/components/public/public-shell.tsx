'use client';

import { Download, Pin } from 'lucide-react';
import { formatBytes, type PublicShareMeta } from '@volumes/shared';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatMoment, isoTitle } from '@/lib/format';

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
      Pinned{meta.pinnedAt ? ` · ${formatMoment(meta.pinnedAt)}` : ''}
    </Badge>
  );
}

/** One column for the bar, the content and the footer, so the lockup, the title and the footer copy share an edge. */
const FRAME = 'mx-auto w-full max-w-[1180px] px-4 min-[720px]:px-6';

/**
 * The public page frame (UNIFY-SPEC §14.4): a 56 px glass top bar on a hair rule (flat KDRIVE lockup, item name,
 * mode badge, primary Download), the content, and a hair-ruled footer with the theme toggle.
 */
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
      <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-vx-hair bg-vx-nav-glass backdrop-blur-[14px]">
        <div className={FRAME + ' flex h-full items-center gap-3'}>
          <Brand href={null} className={cx('shrink-0', meta && 'max-[520px]:[&>span:last-child]:hidden')} />
          {meta ? (
            <>
              <span aria-hidden className="h-5 w-px shrink-0 bg-vx-hair" />
              <span className="min-w-0 truncate text-[15px] font-semibold leading-5 text-vx-text-1" title={meta.name}>
                {meta.name}
              </span>
              <span className="shrink-0 max-[400px]:hidden">
                <ModeChip meta={meta} />
              </span>
            </>
          ) : null}
          <span className="flex-1" />
          {download ? (
            <a href={download.href} className={buttonClass('primary', 'sm', { withIcon: true, className: 'max-[520px]:w-[30px] max-[520px]:px-0' })} aria-label={download.label}>
              <Download size={14} strokeWidth={1.75} aria-hidden />
              <span className="max-[520px]:hidden">{download.label}</span>
            </a>
          ) : null}
        </div>
      </header>
      <main className={FRAME + ' flex flex-1 flex-col pb-12 pt-10 max-[720px]:pt-7'}>{children}</main>
      <footer className="shrink-0 border-t border-vx-hair">
        <div className={FRAME + ' flex min-h-14 items-center justify-between gap-3'}>
          <span className="vx-micro text-vx-text-3">Shared with KDRIVE. Every change is a version.</span>
          <ThemeToggle size="sm" />
        </div>
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
        as it was on {formatMoment(meta.pinnedAt)}
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
    <div className="mb-8 max-[720px]:mb-6">
      <div className="vx-eyebrow">{meta.targetType === 'dir' ? 'Shared folder' : 'Shared file'}</div>
      <h1 className="vx-display mt-3 break-words">{meta.name}</h1>
      <p className="vx-meta mt-3 text-vx-text-3">
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
