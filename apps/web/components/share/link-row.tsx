'use client';

import { useState } from 'react';
import { shortId, type ShareLink } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { formatDate, formatRelative, isoTitle } from '@/lib/format';
import { Badge } from './badge';
import { CopyButton } from './copy-button';
import { linkStatus } from './expiry';

function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/** One share link: badge, facts (created · opens · expiry), Copy, Revoke (inline confirm). */
export function LinkRow({ link, onRevoke }: { link: ShareLink; onRevoke: (link: ShareLink) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = linkStatus(link);
  const inactive = status !== 'active';

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRevoke(link);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the link.');
    } finally {
      setBusy(false);
    }
  };

  const expiry =
    status === 'revoked'
      ? `revoked ${formatRelative(link.revokedAt!)}`
      : link.expiresAt
        ? status === 'expired'
          ? `expired ${formatDate(link.expiresAt)}`
          : `expires ${formatDate(link.expiresAt)}`
        : 'never expires';

  const metaTitle = [
    expiry,
    link.mode === 'pinned' && link.commitId ? shortId(link.commitId) : null,
    plural(link.openCount, 'open'),
    `created ${formatRelative(link.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="border-b border-vx-hair-soft last:border-b-0">
      <div className={cx('flex min-h-11 items-center gap-3 py-2', inactive && 'opacity-80')}>
        {status === 'revoked' ? (
          <Badge tone="dim">Revoked</Badge>
        ) : status === 'expired' ? (
          <Badge tone="dim">Expired</Badge>
        ) : link.mode === 'live' ? (
          <Badge pip>Live</Badge>
        ) : (
          <Badge>Pinned</Badge>
        )}
        {/* Expiry first (the fact that says how long the link lives); wraps to a second line rather than clipping. */}
        <div
          className={cx('vx-meta line-clamp-2 min-w-0 flex-1 break-words', inactive ? 'text-vx-text-4' : 'text-vx-text-3')}
          title={metaTitle}
        >
          <span className={inactive ? '' : 'text-vx-text-2'} title={link.expiresAt ? isoTitle(link.expiresAt) : undefined}>
            {expiry}
          </span>
          {link.mode === 'pinned' && link.commitId ? <span title={link.commitId}> · {shortId(link.commitId)}</span> : null}
          {' · '}
          {plural(link.openCount, 'open')}
          {' · '}
          <span title={isoTitle(link.createdAt)}>created {formatRelative(link.createdAt)}</span>
        </div>
        {status === 'active' ? <CopyButton text={link.url} /> : null}
        {status !== 'revoked' && !confirming ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} title={status === 'expired' && link.mode === 'pinned' ? 'Frees its checkpoint slot' : undefined}>
            {status === 'expired' ? 'Remove' : 'Revoke'}
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="mb-2 flex items-center gap-2 border-l-2 border-vx-danger bg-vx-danger-wash py-1.5 pl-3 pr-1.5">
          <span className="vx-name flex-1 text-vx-text-2">
            {status === 'expired' ? 'Remove this link? It stops counting against your checkpoint slots.' : 'Revoke? Anyone with the link loses access.'}
          </span>
          <Button size="sm" variant="danger" loading={busy} onClick={() => void revoke()}>
            {status === 'expired' ? 'Remove' : 'Revoke'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : null}
      {error ? <p className="mb-2 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{error}</p> : null}
    </li>
  );
}

export default LinkRow;
