'use client';

import { useState } from 'react';
import { CircleAlert, EyeOff, KeyRound, Pin, Users } from 'lucide-react';
import { shortId, type ShareLink, type UpdateLinkRequest } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { formatDate, isoTitle } from '@/lib/format';
import { formatWhen } from '@/components/preview/names';
import { accessBadges, accessRequest, draftFromLink } from './access';
import { AccessFields } from './access-fields';
import { CopyButton } from './copy-button';
import { linkStatus } from './expiry';

function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/** Access badges after the mode badge: who (people), how (password), what (view only). */
function AccessBadges({ link }: { link: ShareLink }) {
  return (
    <>
      {accessBadges(link).map((b) =>
        b === 'people' ? (
          <Badge key={b} icon={<Users strokeWidth={2} aria-hidden />} title={link.allowedEmails.join(', ')}>
            {plural(link.allowedEmails.length, 'person', 'people')}
          </Badge>
        ) : b === 'password' ? (
          <Badge key={b} icon={<KeyRound strokeWidth={2} aria-hidden />} title="Opens with a password">
            Password
          </Badge>
        ) : (
          <Badge key={b} icon={<EyeOff strokeWidth={2} aria-hidden />} title="View only: no download buttons">
            No download
          </Badge>
        ),
      )}
    </>
  );
}

/** Inline access editor under a link row: the create form's access fields, Cancel and Save. */
function AccessEditor({ link, onSave, onDone }: { link: ShareLink; onSave: (req: UpdateLinkRequest) => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState(() => draftFromLink(link));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    let req: UpdateLinkRequest;
    try {
      req = accessRequest(draft, link.hasPassword);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      await onSave(req);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the link.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-2 rounded-vx-md bg-vx-surface-2 px-3.5 py-1.5 shadow-[inset_0_0_0_1px_var(--vx-hair-strong)]">
      <AccessFields value={draft} onChange={setDraft} hadPassword={link.hasPassword} />
      {error ? (
        <p role="alert" className="mb-2 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
          <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1 border-t border-vx-hair-soft py-2">
        <Button size="sm" variant="text" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * One share link (44 h): mode and access badges, meta (commit · opens · expiry), text Copy, Edit (access,
 * inline), danger-text Revoke with an inline confirm.
 */
export function LinkRow({
  link,
  onRevoke,
  onUpdate,
}: {
  link: ShareLink;
  onRevoke: (link: ShareLink) => Promise<void>;
  /** Saves access changes; without it the row has no Edit. */
  onUpdate?: (link: ShareLink, req: UpdateLinkRequest) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = linkStatus(link);
  const inactive = status !== 'active';
  const removing = status === 'expired';

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
      ? `revoked ${formatWhen(link.revokedAt!)}`
      : link.expiresAt
        ? status === 'expired'
          ? `expired ${formatDate(link.expiresAt)}`
          : `expires ${formatDate(link.expiresAt)}`
        : 'never expires';

  const metaTitle = [
    link.mode === 'pinned' && link.commitId ? shortId(link.commitId) : null,
    plural(link.openCount, 'open'),
    expiry,
    `created ${formatWhen(link.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="border-b border-vx-hair-soft last:border-b-0">
      <div className="-mx-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 transition-colors duration-[120ms] hover:bg-vx-raise">
        {status === 'revoked' ? (
          <Badge tone="dashed">Revoked</Badge>
        ) : status === 'expired' ? (
          <Badge tone="dashed">Expired</Badge>
        ) : link.mode === 'live' ? (
          <Badge tone="live" pip>
            Live
          </Badge>
        ) : (
          <Badge icon={<Pin strokeWidth={2} aria-hidden />}>Pinned</Badge>
        )}
        {status === 'active' ? <AccessBadges link={link} /> : null}
        <div className={cx('vx-meta-row min-w-0 flex-1 truncate text-vx-text-3', inactive && 'opacity-70')} title={metaTitle}>
          {link.mode === 'pinned' && link.commitId ? (
            <>
              <span title={link.commitId}>
                {shortId(link.commitId)}
              </span>
              {' · '}
            </>
          ) : null}
          {plural(link.openCount, 'open')}
          {' · '}
          <span title={link.expiresAt ? isoTitle(link.expiresAt) : undefined}>{expiry}</span>
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          {status === 'active' ? <CopyButton text={link.url} variant="text" className="min-w-0" /> : null}
          {status === 'active' && onUpdate && !editing && !confirming ? (
            <Button size="sm" variant="text" onClick={() => setEditing(true)} title="Who can open it, password and downloads">
              Edit
            </Button>
          ) : null}
          {status !== 'revoked' && !confirming && !editing ? (
            <Button
              size="sm"
              variant="danger-text"
              onClick={() => setConfirming(true)}
              title={removing && link.mode === 'pinned' ? 'Frees its checkpoint slot' : undefined}
            >
              {removing ? 'Remove' : 'Revoke'}
            </Button>
          ) : null}
        </div>
      </div>
      {editing && onUpdate ? <AccessEditor link={link} onSave={(req) => onUpdate(link, req)} onDone={() => setEditing(false)} /> : null}
      {confirming ? (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-vx-md bg-vx-danger-wash px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--vx-danger-edge)]">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold leading-5 text-vx-text-1">{removing ? 'Remove this link?' : 'Revoke this link?'}</div>
            <div className="mt-0.5 text-[13px] leading-5 text-vx-text-2">
              {removing ? 'It stops counting against your checkpoint slots.' : 'Anyone who has it loses access.'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="text" disabled={busy} onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => void revoke()}>
              {removing ? 'Remove' : 'Revoke'}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
          <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </li>
  );
}

export default LinkRow;
