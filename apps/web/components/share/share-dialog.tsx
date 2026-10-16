'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { CircleAlert, Link2, Lock, Pin } from 'lucide-react';
import { TAG_BUDGET, basename, formatBytes, previewKind, shortId, type ShareLink, type UpdateLinkRequest } from '@volumes/shared';
import { kindLabel } from '@/components/preview/names';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { FileIcon } from '@/components/ui/file-icon';
import { DateTimePicker, roundUpToSlot } from '@/components/ui/date-time-picker';
import { Input } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useStat } from '@/lib/api/hooks';
import { formatAgo, formatMoment, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { accessRequest, OPEN_ACCESS, type AccessDraft } from './access';
import { AccessFields } from './access-fields';
import { copyText, CopyButton } from './copy-button';
import { expiryToIso, linkStatus, sortLinks, toLocalInput, type ExpiryChoice } from './expiry';
import { LinkRow } from './link-row';
import { useUploadLinkTab } from './upload-link-tab';

const noRetry = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

/** A danger row inside the dialog body (budget full, create errors). */
function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Option card (r6): a 32 px r4 icon tile, a title and one line; `on` gets a 1 px accent-edge ring and the selection fill. */
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
        'vx-inset-focus flex min-h-[60px] min-w-0 items-center gap-3 rounded-vx-md px-3.5 py-3 text-left transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
        on
          ? 'bg-vx-selection shadow-[inset_0_0_0_1px_var(--vx-accent-edge)]'
          : 'shadow-[inset_0_0_0_1px_var(--vx-hair-strong)] enabled:hover:bg-vx-raise',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-vx-sm',
          on ? 'bg-vx-accent text-vx-on-accent' : 'bg-vx-surface-3 text-vx-text-2',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cx('block text-[14px] font-semibold leading-5', on ? 'text-vx-on-selection' : 'text-vx-text-1')}>{title}</span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-vx-text-3">{body}</span>
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

function ShareBody({ ws, path, tab: initialTab, onClose }: { ws: string; path: string; tab?: 'upload'; onClose: () => void }) {
  const timeTravel = useVx((s) => s.timeTravel);
  const past = !!timeTravel;
  const at = timeTravel?.commitId ?? null;
  const [mode, setMode] = useState<'live' | 'pinned'>(past ? 'pinned' : 'live');
  const [expiry, setExpiry] = useState<ExpiryChoice>('never');
  const [custom, setCustom] = useState(() => roundUpToSlot(new Date(Date.now() + 7 * 24 * 3600_000)));
  const [access, setAccess] = useState<AccessDraft>(OPEN_ACCESS);
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
  const sorted = useMemo(() => sortLinks((links.data?.links ?? []).filter((l) => l.kind !== 'upload')), [links.data]);
  const activeCount = sorted.filter((l) => linkStatus(l) === 'active').length;
  const name = basename(path) || 'My Drive';

  // Folders in the present also get an Upload link tab (people send files in).
  const [tab, setTab] = useState<'link' | 'upload'>(initialTab ?? 'link');
  const canUpload = isDir && !past;
  const upload = useUploadLinkTab({ ws, path, name, onClose });
  const onUpload = canUpload && tab === 'upload';

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
    let accessFields: ReturnType<typeof accessRequest>;
    try {
      expiresAt = expiryToIso(expiry, toLocalInput(custom));
      accessFields = accessRequest(access);
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
        ...accessFields,
      });
      setAccess((a) => ({ ...a, password: '' }));
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

  const update = async (link: ShareLink, req: UpdateLinkRequest) => {
    const { link: next } = await api.links.update(ws, link.id, req);
    if (created?.id === link.id) setCreated(next);
    await links.mutate();
  };

  const revoke = async (link: ShareLink) => {
    await api.links.revoke(ws, link.id);
    if (created?.id === link.id) setCreated(null);
    await Promise.all([links.mutate(), link.mode === 'pinned' ? budget.mutate() : null]);
  };

  const label = 'mb-2 block text-[13px] font-medium leading-5 text-vx-text-2';

  return (
    <Dialog
      open
      onClose={onClose}
      width={560}
      busy={busy || upload.busy}
      icon={<FileIcon name={name} type={isDir ? 'dir' : 'file'} size={32} />}
      title={
        <span className="block truncate" title={path}>
          Share &ldquo;{name}&rdquo;
        </span>
      }
      description={description}
      footer={
        onUpload ? upload.footer : <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Done
          </Button>
          <Button variant="primary" onClick={() => void create()} loading={busy} disabled={full}>
            Create link
          </Button>
        </>
      }
      note={
        onUpload ? upload.note : <>
          <Lock size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span>
            Unless you limit it, anyone with a link can view and download without signing in. Nobody can change your files through it.
          </span>
        </>
      }
    >
      {canUpload ? (
        <Tabs
          className="mb-4"
          items={[
            { id: 'link', label: 'Share link' },
            { id: 'upload', label: 'Upload link' },
          ]}
          value={tab}
          onChange={setTab}
        />
      ) : null}
      {onUpload ? upload.body : <div className="flex flex-col gap-5 pb-2">
        <div>
          <span className={label} id="share-type">
            Link type
          </span>
          <div role="radiogroup" aria-labelledby="share-type" className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
            <OptionCard
              on={mode === 'live'}
              disabled={past}
              icon={<Link2 size={16} strokeWidth={1.75} />}
              title="Live link"
              body="Always the latest"
              onSelect={() => {
                setMode('live');
                setError(null);
              }}
            />
            <OptionCard
              on={mode === 'pinned'}
              icon={<Pin size={16} strokeWidth={1.75} />}
              title="Pinned link"
              body="Frozen at this version"
              onSelect={() => {
                setMode('pinned');
                setError(null);
              }}
            />
          </div>
          {mode === 'pinned' ? (
            <p className="vx-meta mt-2 text-vx-text-3">
              <>
                Pinned to{' '}
                <span className={past ? 'font-medium text-vx-past' : 'text-vx-text-2'} title={pinnedAt ? isoTitle(pinnedAt) : undefined}>
                  {pinnedAt ? formatMoment(pinnedAt) : past ? '…' : 'the current version'}
                </span>
                {pinnedCommit ? (
                  <>
                    {' · '}
                    <span>{shortId(pinnedCommit)}</span>
                  </>
                ) : null}{' '}
                · uses 1 of {max} checkpoint slots
                {b ? <span className="text-vx-text-3"> ({b.used} used)</span> : null}
              </>
            </p>
          ) : null}
          {past ? <p className="vx-micro mt-1 text-vx-text-3">In the past, links are pinned to the version you are viewing.</p> : null}
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
            <div className="mt-3">
              <DateTimePicker
                label="Expires at"
                value={custom}
                min={new Date(Date.now() + 60_000)}
                onChange={(d) => {
                  setCustom(d);
                  setError(null);
                }}
              />
              <p className="vx-meta mt-2 text-vx-text-3" title={isoTitle(custom)}>
                Expires <span className="text-vx-text-2">{formatMoment(custom)}</span> · {formatAgo(custom)}
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <span className={label} id="share-access">
            Access
          </span>
          <div role="group" aria-labelledby="share-access" className="-my-2.5">
            <AccessFields
              value={access}
              onChange={(a) => {
                setAccess(a);
                setError(null);
              }}
            />
          </div>
        </div>

        {full || error?.code === 'tag_budget_exceeded' ? (
          <ErrorRow>
            All {max} checkpoint slots are used ({b?.used ?? max} of {max}). Remove a checkpoint or a pinned link first.
          </ErrorRow>
        ) : null}
        {error && error.code !== 'tag_budget_exceeded' ? <ErrorRow>{error.message}</ErrorRow> : null}

        {created ? (
          <div className="flex h-10 items-center gap-2 rounded-vx-sm border border-vx-hair bg-vx-surface-2 pl-3 pr-1">
            <Link2 size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-3" aria-hidden />
            <input
              readOnly
              value={created.url}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
              className="vx-inset-focus min-w-0 flex-1 truncate rounded-vx-xs bg-transparent px-1 py-1 font-mono text-[12.5px] text-vx-text-1 outline-none"
            />
            <CopyButton key={created.id} text={created.url} flashOnMount={autoCopied} />
          </div>
        ) : null}

        <section className="border-t border-vx-hair pt-4">
          <div className="flex h-8 items-center justify-between border-b border-vx-hair">
            <h3 className="vx-colhead">Active links</h3>
            <span className="vx-meta text-vx-text-3">{links.data ? activeCount : ''}</span>
          </div>
          {links.error ? (
            <div className="flex items-center gap-2 py-3">
              <span className="text-[13px] text-vx-danger">Couldn&apos;t load the links.</span>
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
            <p className="vx-body py-3 text-vx-text-3">No links yet.</p>
          ) : (
            <ul>
              {sorted.map((l) => (
                <LinkRow key={l.id} link={l} onRevoke={revoke} onUpdate={update} />
              ))}
            </ul>
          )}
        </section>
      </div>}
    </Dialog>
  );
}

/**
 * Share dialog (560): create live or pinned links with an expiry and access (people, password, downloads),
 * copy, list, edit access and revoke. Opened by `openShare(path)`.
 */
export default function ShareDialog() {
  const share = useVx((s) => s.share);
  const ws = useVx((s) => s.workspaceId);
  const close = useVx((s) => s.closeShare);
  if (!share || !ws) return null;
  return <ShareBody key={`${ws}:${share.path}:${share.tab ?? ''}`} ws={ws} path={share.path} tab={share.tab} onClose={close} />;
}
