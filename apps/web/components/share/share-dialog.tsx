'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { TAG_BUDGET, basename, shortId, type ShareLink } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useStat } from '@/lib/api/hooks';
import { formatTimeTravelLabel, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { CopyButton, copyText } from './copy-button';
import { expiryToIso, linkStatus, sortLinks, toLocalInput, type ExpiryChoice } from './expiry';
import { LinkRow } from './link-row';

const noRetry = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

function BudgetFull({ used, max }: { used: number; max: number }) {
  return (
    <p role="alert" className="border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">
      All {max} checkpoint slots are used ({used} of {max}). Remove a checkpoint or a pinned link first.
    </p>
  );
}

/** Two blocks joined by a connector: the share-links empty state art. */
function LinksArt() {
  return (
    <svg width="72" height="36" viewBox="0 0 72 36" aria-hidden className="mb-3">
      <path d="M4 12 L16 6 L28 12 L16 18 Z" fill="var(--ea-top)" stroke="var(--ea-line)" />
      <path d="M4 12 L16 18 L16 26 L4 20 Z" fill="var(--ea-left)" stroke="var(--ea-line)" />
      <path d="M16 18 L28 12 L28 20 L16 26 Z" fill="var(--ea-mid)" stroke="var(--ea-line)" />
      <path d="M28 16 L44 16" stroke="var(--ea-line)" strokeDasharray="2 2" />
      <path d="M44 12 L56 6 L68 12 L56 18 Z" fill="none" stroke="var(--ea-line)" strokeDasharray="3 2" />
      <path d="M44 12 L56 18 L56 26 L44 20 Z" fill="none" stroke="var(--ea-line-dim)" strokeDasharray="3 2" />
      <rect x="34" y="13" width="4" height="4" fill="var(--ea-accent)" transform="rotate(45 36 15)" />
    </svg>
  );
}

function ShareBody({ ws, path, onClose }: { ws: string; path: string; onClose: () => void }) {
  const timeTravel = useVx((s) => s.timeTravel);
  const past = !!timeTravel;
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

  const { data: stat } = useStat(path, timeTravel?.commitId ?? null);
  const links = useSWR(['links', ws, path], () => api.links.list(ws, { path }), noRetry);
  const budget = useSWR(['checkpoints', ws], () => api.checkpoints.list(ws), noRetry);
  const head = useSWR(mode === 'pinned' && !past ? ['commit', ws, 'head'] : null, () => api.versioning.commit(ws, 'head'), noRetry);

  const b = budget.data?.budget;
  const max = b?.max ?? TAG_BUDGET;
  const full = mode === 'pinned' && !!b && b.used >= b.max;
  const sorted = useMemo(() => sortLinks(links.data?.links ?? []), [links.data]);
  const activeCount = sorted.filter((l) => linkStatus(l) === 'active').length;
  const isDir = stat?.type === 'dir';
  const name = basename(path) || 'My Drive';

  const pinnedAt = past ? timeTravel!.createdAt : head.data?.createdAt;
  const pinnedCommit = past ? timeTravel!.commitId : head.data?.id;

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

  const label = 'w-[72px] shrink-0 pt-1.5 vx-label';

  return (
    <Dialog
      open
      onClose={onClose}
      width={560}
      busy={busy}
      title={
        <span className="flex items-center gap-3">
          Share
          <span className="max-w-[380px] truncate font-mono text-[12px] normal-case tracking-normal text-vx-text-1" title={path}>
            {name}
            {isDir ? '/' : ''}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className={label}>Mode</div>
          <div className="min-w-0 flex-1">
            <Segmented
              label="Link mode"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'live', label: 'Live — always latest', disabled: past },
                { value: 'pinned', label: 'Pinned — this version' },
              ]}
            />
            <p className="vx-meta mt-2 text-vx-text-3">
              {mode === 'live' ? (
                past ? null : (
                  <>Follows every change: visitors always see the latest {isDir ? 'contents' : 'version'}.</>
                )
              ) : (
                <>
                  Pinned to{' '}
                  <span className={past ? 'text-vx-past' : 'text-vx-text-2'} title={pinnedAt ? isoTitle(pinnedAt) : undefined}>
                    {pinnedAt ? formatTimeTravelLabel(pinnedAt) : past ? '…' : 'the current version'}
                  </span>
                  {pinnedCommit ? <> · {shortId(pinnedCommit)}</> : null} · uses 1 of {max} checkpoint slots
                  {b ? <span className="text-vx-text-4"> ({b.used} used)</span> : null}
                </>
              )}
            </p>
            {past ? (
              <p className="vx-micro mt-1 text-vx-text-4">You are viewing the past, so the link is pinned to this version. Live links are made from now.</p>
            ) : null}
          </div>
        </div>

        <div className="flex gap-3">
          <div className={label}>Expires</div>
          <div className="min-w-0 flex-1">
            <Segmented
              label="Expiry"
              value={expiry}
              onChange={(v) => {
                setExpiry(v);
                setError(null);
              }}
              options={[
                { value: 'never', label: 'Never' },
                { value: '1d', label: '1 day' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {expiry === 'custom' ? (
              <div className="mt-2 w-[240px]">
                <Input
                  type="datetime-local"
                  mono
                  aria-label="Expires at"
                  value={custom}
                  min={toLocalInput(new Date())}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </div>
            ) : null}
          </div>
        </div>

        {full || error?.code === 'tag_budget_exceeded' ? <BudgetFull used={b?.used ?? max} max={max} /> : null}
        {error && error.code !== 'tag_budget_exceeded' ? (
          <p role="alert" className="border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">
            {error.message}
          </p>
        ) : null}

        <div>
          <Button variant="primary" onClick={() => void create()} loading={busy} disabled={full}>
            Create link
          </Button>
        </div>

        {created ? (
          <div className="flex items-center gap-2 border-t border-vx-hair pt-4">
            <Input readOnly mono value={created.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1" />
            <CopyButton key={created.id} text={created.url} size="md" flashOnMount={autoCopied} />
          </div>
        ) : null}

        <section className="border-t border-vx-hair pt-3">
          <div className="pt-band vx-label mb-1">
            Active links <span className="text-vx-text-4">{activeCount}</span>
          </div>
          {links.error ? (
            <div className="flex items-center gap-2 py-3">
              <span className="text-[12px] text-vx-danger">Couldn&apos;t load the links.</span>
              <Button size="sm" variant="ghost" onClick={() => void links.mutate()}>
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
              <LinksArt />
              <div className="vx-title">No links yet.</div>
              <p className="vx-body mt-1 text-vx-text-3">Live links follow changes. Pinned links freeze a version.</p>
            </div>
          ) : (
            <ul>
              {sorted.map((l) => (
                <LinkRow key={l.id} link={l} onRevoke={revoke} />
              ))}
            </ul>
          )}
          <p className="vx-micro mt-2 text-vx-text-4">Anyone with a link can view and download, without signing in. Nobody can change your files through it.</p>
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
