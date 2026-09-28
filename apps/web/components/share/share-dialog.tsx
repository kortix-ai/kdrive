'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Bookmark, CircleAlert, Link2, Lock } from 'lucide-react';
import { TAG_BUDGET, basename, formatBytes, previewKind, shortId, type ShareLink } from '@volumes/shared';
import { kindLabel } from '@/components/preview/names';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { EmptyArt } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useStat } from '@/lib/api/hooks';
import { formatTimeTravelLabel, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { copyText, CopyButton } from './copy-button';
import { expiryToIso, linkStatus, sortLinks, toLocalInput, type ExpiryChoice } from './expiry';
import { LinkRow } from './link-row';

const noRetry = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

/** A danger row inside the dialog body (budget full, create errors). */
function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-del-fg">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Option card (r12): a 36 px icon disc, a title and one line; `on` gets a 2 px accent border and the selection tint. */
function OptionCard({
  on,
  disabled,
  icon,
  title,
  body,
  onSelect,
}: {
  on: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'vx-inset-focus flex min-w-0 items-center gap-3 rounded-vx-md px-4 py-3.5 text-left transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
        on
          ? 'bg-vx-selection shadow-[inset_0_0_0_2px_var(--vx-accent)]'
          : 'shadow-[inset_0_0_0_1px_var(--vx-hair-strong)] enabled:hover:bg-vx-hover',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          on ? 'bg-vx-accent text-vx-on-accent' : 'bg-vx-surface-3 text-vx-text-2',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cx('block text-[14px] font-semibold leading-5', on ? 'text-vx-on-selection' : 'text-vx-text-1')}>{title}</span>
        <span className="vx-meta block text-vx-text-3">{body}</span>
      </span>
    </button>
  );
}

const EXPIRY: { value: ExpiryChoice; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom…' },
];

function ShareBody({ ws, path, onClose }: { ws: string; path: string; onClose: () => void }) {
  const timeTravel = useVx((s) => s.timeTravel);
  const past = !!timeTravel;
  const at = timeTravel?.commitId ?? null;
  const [mode, setMode] = useState<'live' | 'pinned'>(past ? 'pinned' : 'live');
  const [expiry, setExpiry] = useState<ExpiryChoice>('never');
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 7 * 24 * 3600_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);

  useEffect(() => {
    if (past) setMode('pinned');
  }, [past]);

  const { data: stat } = useStat(path, at);
  const isDir = stat?.type === 'dir';
  // Same key as the drive listing (key-derived fetcher), so an open folder costs nothing.
  const listing = useSWR(
    isDir ? (['ls', ws, path, at] as [string, string, string, string | null]) : null,
    ([, w, p, a]: [string, string, string, string | null]) => api.files.list(w, { path: p, at: a }),
    { ...noRetry, keepPreviousData: true },
  );
  const links = useSWR(['links', ws, path], () => api.links.list(ws, { path }), noRetry);
  const budget = useSWR(['checkpoints', ws], () => api.checkpoints.list(ws), noRetry);
  const head = useSWR(mode === 'pinned' && !past ? ['commit', ws, 'head'] : null, () => api.versioning.commit(ws, 'head'), noRetry);

  const b = budget.data?.budget;
  const max = b?.max ?? TAG_BUDGET;
  const full = mode === 'pinned' && !!b && b.used >= b.max;
  const sorted = useMemo(() => sortLinks(links.data?.links ?? []), [links.data]);
  const activeCount = sorted.filter((l) => linkStatus(l) === 'active').length;
  const name = basename(path) || 'My Drive';

  const pinnedAt = past ? timeTravel!.createdAt : head.data?.createdAt;
  const pinnedCommit = past ? timeTravel!.commitId : head.data?.id;

  const description = !stat
    ? '…'
    : isDir
      ? [
          'Folder',
          listing.data ? `${listing.data.entries.length} ${listing.data.entries.length === 1 ? 'item' : 'items'}` : null,
          stat.size ? formatBytes(stat.size) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : `${kindLabel(stat.name, previewKind(stat.name))} · ${formatBytes(stat.size)}`;

  const create = async () => {
    if (busy) return;
    setError(null);
    let expiresAt: string | null;
    try {
      expiresAt = expiryToIso(expiry, custom);
    } catch (e) {
      setError({ code: 'bad_request', message: (e as Error).message });
      return;
    }
    if (full) {
      setError({ code: 'tag_budget_exceeded', message: '' });
      return;
    }
    setBusy(true);
    try {
      const { link } = await api.links.create(ws, {
        path,
        mode,
        ...(mode === 'pinned' && past ? { at: timeTravel!.commitId } : {}),
        expiresAt,
      });
      setAutoCopied(await copyText(link.url));
      setCreated(link);
      await Promise.all([links.mutate(), mode === 'pinned' ? budget.mutate() : null]);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError({ code: err?.code ?? 'internal', message: e instanceof Error ? e.message : 'Could not create the link.' });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (link: ShareLink) => {
    await api.links.revoke(ws, link.id);
    if (created?.id === link.id) setCreated(null);
    await Promise.all([links.mutate(), link.mode === 'pinned' ? budget.mutate() : null]);
  };

  const label = 'mb-2 block text-[13px] font-semibold leading-5 text-vx-text-2';

  return (
    <Dialog
      open
      onClose={onClose}
      width={560}
      busy={busy}
      icon={<FileIcon name={name} type={isDir ? 'dir' : 'file'} size={32} />}
      title={
        <span className="block truncate" title={path}>
          Share &ldquo;{name}&rdquo;
        </span>
      }
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Done
          </Button>
          <Button variant="primary" onClick={() => void create()} loading={busy} disabled={full}>
            Create link
          </Button>
        </>
      }
      note={
        <>
          <Lock size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span>Anyone with a link can view and download without signing in. Nobody can change your files through it.</span>
        </>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <div>
          <span className={label} id="share-type">
            Link type
          </span>
          <div role="radiogroup" aria-labelledby="share-type" className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
            <OptionCard
              on={mode === 'live'}
              disabled={past}
              icon={<Link2 size={18} strokeWidth={1.75} />}
              title="Live link"
              body="Always shows the latest version"
              onSelect={() => {
                setMode('live');
                setError(null);
              }}
            />
            <OptionCard
              on={mode === 'pinned'}
              icon={<Bookmark size={18} strokeWidth={1.75} />}
              title="Pinned link"
              body="Frozen at this version"
              onSelect={() => {
                setMode('pinned');
                setError(null);
              }}
            />
          </div>
          <p className="vx-meta mt-2 text-vx-text-3">
            {mode === 'live' ? (
              <>Follows every change: visitors always see the latest {isDir ? 'contents' : 'version'}.</>
            ) : (
              <>
                Pinned to{' '}
                <span className={past ? 'font-medium text-vx-past' : 'text-vx-text-2'} title={pinnedAt ? isoTitle(pinnedAt) : undefined}>
                  {pinnedAt ? formatTimeTravelLabel(pinnedAt) : past ? '…' : 'the current version'}
                </span>
                {pinnedCommit ? (
                  <>
                    {' · '}
                    <span className="font-mono">{shortId(pinnedCommit)}</span>
                  </>
                ) : null}{' '}
                · uses 1 of {max} checkpoint slots
                {b ? <span className="text-vx-text-4"> ({b.used} used)</span> : null}
              </>
            )}
          </p>
          {past ? <p className="vx-meta mt-1 text-vx-text-3">In the past, links are pinned to the version you are viewing.</p> : null}
        </div>

        <div>
          <span className={label} id="share-expiry">
            Expires
          </span>
          <div role="group" aria-labelledby="share-expiry" className="flex flex-wrap gap-2">
            {EXPIRY.map((o) => (
              <Chip
                key={o.value}
                on={expiry === o.value}
                onClick={() => {
                  setExpiry(o.value);
                  setError(null);
                }}
              >
                {o.label}
              </Chip>
            ))}
          </div>
          {expiry === 'custom' ? (
            <div className="mt-3 w-full max-w-[260px]">
              <Input
                type="datetime-local"
                size="sm"
                aria-label="Expires at"
                value={custom}
                min={toLocalInput(new Date())}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {full || error?.code === 'tag_budget_exceeded' ? (
          <ErrorRow>
            All {max} checkpoint slots are used ({b?.used ?? max} of {max}). Remove a checkpoint or a pinned link first.
          </ErrorRow>
        ) : null}
        {error && error.code !== 'tag_budget_exceeded' ? <ErrorRow>{error.message}</ErrorRow> : null}

        {created ? (
          <div className="flex h-12 items-center gap-2 rounded-vx-sm bg-vx-surface-2 pl-3 pr-2">
            <Link2 size={18} strokeWidth={1.75} className="shrink-0 text-vx-text-3" aria-hidden />
            <input
              readOnly
              value={created.url}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
              className="vx-inset-focus min-w-0 flex-1 truncate rounded-vx-xs bg-transparent px-1 py-1 font-mono text-[13px] text-vx-text-1 outline-none"
            />
            <CopyButton key={created.id} text={created.url} flashOnMount={autoCopied} />
          </div>
        ) : null}

        <section className="border-t border-vx-hair-soft pt-4">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold leading-5 text-vx-text-2">Active links</h3>
            <span className="vx-meta text-vx-text-3">{links.data ? activeCount : ''}</span>
          </div>
          {links.error ? (
            <div className="flex items-center gap-2 py-3">
              <span className="text-[13px] text-vx-del-fg">Couldn&apos;t load the links.</span>
              <Button size="sm" variant="text" onClick={() => void links.mutate()}>
                Retry
              </Button>
            </div>
          ) : !links.data ? (
            <div className="py-3">
              <span className="skeleton skel-line w-3/4" />
              <span className="skeleton skel-line w-2/3" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <EmptyArt size={72} float={false} className="mb-3" />
              <div className="text-[15px] font-semibold leading-6 text-vx-text-1">No links yet.</div>
              <p className="vx-body mt-1 text-vx-text-3">Live links follow changes. Pinned links freeze a version.</p>
            </div>
          ) : (
            <ul>
              {sorted.map((l) => (
                <LinkRow key={l.id} link={l} onRevoke={revoke} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/** Share dialog (560): create live or pinned links with an expiry, copy, list and revoke. Opened by `openShare(path)`. */
export default function ShareDialog() {
  const share = useVx((s) => s.share);
  const ws = useVx((s) => s.workspaceId);
  const close = useVx((s) => s.closeShare);
  if (!share || !ws) return null;
  return <ShareBody key={`${ws}:${share.path}`} ws={ws} path={share.path} onClose={close} />;
}
