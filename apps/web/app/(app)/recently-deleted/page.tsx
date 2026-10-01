'use client';

// /recently-deleted — deleted items that can still come back (DESIGN-v2 §6.10).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Ellipsis, RotateCcw, X } from 'lucide-react';
import { basename, dirname, type DeletedItem } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { Bytes, When } from '@/components/versioning/readout';
import { RetentionNote } from '@/components/versioning/retention-note';
import '@/components/versioning/versioning.css';
import { api } from '@/lib/api/endpoints';
import { retryBusy } from '@/lib/drive/actions';
import { useVx } from '@/lib/store';
import { driveHref } from '@/lib/urls';
import { errorText, useDeleted } from '@/lib/versioning/hooks';
import { groupByDay } from '@/lib/versioning/timeline';

const UNRESTORABLE = 'Its last version is no longer kept.';
const keyOf = (it: DeletedItem) => `${it.actionId}:${it.path}`;
const RD_GRID =
  'grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_128px_88px_148px] items-center gap-x-3 pr-2 max-[900px]:grid-cols-[40px_minmax(0,1fr)_128px_88px_148px] max-[720px]:grid-cols-[40px_minmax(0,1fr)_40px] max-[720px]:pr-1';

export default function RecentlyDeletedPage() {
  const router = useRouter();
  const ws = useVx((s) => s.workspaceId);
  const registerUndo = useVx((s) => s.registerUndo);
  const refresh = useVx((s) => s.refresh);
  const toast = useVx((s) => s.toast);
  const { data, error, isLoading, mutate } = useDeleted();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [collapsing, setCollapsing] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  const items = useMemo(() => (data?.items ?? []).filter((it) => !gone.has(keyOf(it))), [data, gone]);
  const groups = useMemo(() => groupByDay([...items].sort((x, y) => y.deletedAt.localeCompare(x.deletedAt)).map((it) => ({ ...it, createdAt: it.deletedAt }))), [items]);
  const restorableSel = items.filter((it) => selected.has(keyOf(it)) && it.restorable);

  const markBusy = (keys: string[], on: boolean) =>
    setBusy((s) => {
      const n = new Set(s);
      for (const k of keys) if (on) n.add(k);
      else n.delete(k);
      return n;
    });

  /**
   * Restores items that go back to the SAME version with one request: one
   * action, one timeline entry, one undo (never N of each).
   */
  const restoreGroup = async (group: DeletedItem[], at: string): Promise<void> => {
    if (!ws || !group.length) return;
    const keys = group.map(keyOf);
    markBusy(keys, true);
    try {
      const paths = group.map((it) => it.path);
      const scope = group.some((it) => it.type === 'dir') ? 'folder' : 'file';
      const r = await retryBusy(() =>
        paths.length === 1 ? api.versioning.restore(ws, { scope, path: paths[0], at }) : api.versioning.restore(ws, { scope, paths, at }),
      );
      // the rows collapse (160 ms), then leave the list
      setCollapsing((s) => new Set([...s, ...keys]));
      setTimeout(() => setGone((s) => new Set([...s, ...keys])), 170);
      setSelected((s) => {
        const n = new Set(s);
        for (const k of keys) n.delete(k);
        return n;
      });
      const label = group.length === 1 ? `Restored ${basename(group[0].path) || group[0].path}` : `Restored ${group.length} items`;
      registerUndo({ label, actionId: r.action.id, workspaceId: ws });
    } catch (e) {
      const what = group.length === 1 ? basename(group[0].path) : `${group.length} items`;
      toast({ kind: 'error', message: `Couldn't restore ${what}: ${errorText(e)}` });
    } finally {
      markBusy(keys, false);
    }
  };

  const restoreMany = async (list: DeletedItem[]) => {
    // Something else has taken the name since: show what the restore would replace first.
    const occupied = list.filter((it) => it.occupied && it.restoreAt);
    if (occupied.length === 1 && list.length === 1) {
      const it = occupied[0];
      useVx.getState().openRestore({ scope: it.type === 'dir' ? 'folder' : 'file', path: it.path, at: it.restoreAt! });
      return;
    }
    if (occupied.length) {
      toast({
        kind: 'info',
        message: `${occupied.length === 1 ? '1 item was' : `${occupied.length} items were`} left out: something else has that name now. Restore ${occupied.length === 1 ? 'it' : 'them'} one at a time.`,
      });
    }
    const byVersion = new Map<string, DeletedItem[]>();
    for (const it of list) {
      if (!it.restoreAt || it.occupied) continue;
      const g = byVersion.get(it.restoreAt) ?? [];
      g.push(it);
      byVersion.set(it.restoreAt, g);
    }
    for (const [at, group] of byVersion) await restoreGroup(group, at);
    refresh();
    setTimeout(() => void mutate(), 200);
  };

  const showInTime = async (it: DeletedItem) => {
    if (!ws || !it.restoreAt) return;
    const commit = await api.versioning.commit(ws, it.restoreAt).catch(() => null);
    const s = useVx.getState();
    s.enterTimeTravel({ commitId: it.restoreAt, createdAt: commit?.createdAt ?? it.deletedAt });
    const parent = dirname(it.path);
    s.setPath(parent);
    s.select([it.path]);
    router.push(driveHref(parent));
  };

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const allRestorable = items.filter((it) => it.restorable);
  const allOn = allRestorable.length > 0 && allRestorable.every((it) => selected.has(keyOf(it)));
  const anySelected = selected.size > 0;
  const moreMenu = (it: DeletedItem, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({
      at: { x: r.right - 240, y: r.bottom + 4 },
      items: [
        { id: 'restore', label: 'Restore to original place', icon: <RotateCcw size={18} strokeWidth={1.75} />, tone: 'past', disabled: !it.restorable, reason: UNRESTORABLE, onSelect: () => void restoreMany([it]) },
        { id: 'time', label: 'Show in time', icon: <Clock size={18} strokeWidth={1.75} />, onSelect: () => void showInTime(it) },
      ],
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1040px] px-6 pb-10 pt-6 max-[720px]:px-4">
      <header>
        <h1 className="vx-h1">Recently deleted</h1>
        <p className="vx-body mt-2 max-w-[640px] text-vx-text-3">Items stay recoverable while the version before the delete is kept.</p>
        <RetentionNote className="mt-1" />
      </header>

      <div className="mt-6">
        {isLoading ? (
          <div aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-11 items-center gap-4 px-3">
                <span className="skeleton h-5 w-5" />
                <span className="skeleton skel-line w-48" />
                <span className="skeleton skel-line w-32 max-[720px]:hidden" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            tone="past"
            title="Couldn't load deleted items."
            body={errorText(error)}
            actions={
              <Button variant="tonal" onClick={() => void mutate()}>
                Retry
              </Button>
            }
          />
        ) : !items.length ? (
          <EmptyState title="Nothing deleted." body="Deleted items stay here while their history is kept." />
        ) : (
          <div role="list" aria-label="Deleted items">
            {/* column header, or the selection bar while anything is selected */}
            <div className="sticky top-0 z-[2] bg-vx-surface pb-1">
              {anySelected ? (
                <div className="fade-in flex h-11 items-center gap-2 rounded-full bg-vx-selection pl-1.5 pr-1.5 text-vx-on-selection">
                  <IconButton size="sm" label="Clear selection" onClick={() => setSelected(new Set())} className="!text-vx-on-selection">
                    <X size={18} strokeWidth={1.75} aria-hidden />
                  </IconButton>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5">
                    {selected.size} selected
                    {restorableSel.length !== selected.size ? <span className="vx-meta font-normal"> · {restorableSel.length} can be restored</span> : null}
                  </span>
                  <Button
                    variant="tonal"
                    size="sm"
                    icon={<RotateCcw size={16} strokeWidth={1.75} aria-hidden />}
                    disabled={!restorableSel.length}
                    loading={restorableSel.some((it) => busy.has(keyOf(it)))}
                    onClick={() => void restoreMany(restorableSel)}
                  >
                    Restore {restorableSel.length} {restorableSel.length === 1 ? 'item' : 'items'}
                  </Button>
                </div>
              ) : (
                <div className={cx(RD_GRID, 'h-11 border-b border-vx-hair text-[13px] font-medium leading-5 text-vx-text-3')}>
                  <span className="flex justify-center">
                    <Checkbox
                      checked={allOn}
                      indeterminate={anySelected && !allOn}
                      disabled={!allRestorable.length}
                      label="Select all restorable items"
                      onChange={(on) => setSelected(on ? new Set(allRestorable.map(keyOf)) : new Set())}
                    />
                  </span>
                  <span>Name</span>
                  <span className="max-[900px]:hidden">Original folder</span>
                  <span className="max-[720px]:hidden">Deleted</span>
                  <span className="text-right max-[720px]:hidden">Size</span>
                  <span />
                </div>
              )}
            </div>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="vx-eyebrow px-3 pb-1.5 pt-4">{g.label}</div>
                {g.items.map((it) => {
                  const k = keyOf(it);
                  const isBusy = busy.has(k);
                  const on = selected.has(k);
                  const folder = dirname(it.path);
                  const folderLabel = folder === '/' ? 'My Drive' : folder;
                  return (
                    <div
                      key={k}
                      role="listitem"
                      className={cx(
                        RD_GRID,
                        'vxv-collapse group min-h-11 rounded-vx-sm',
                        on ? 'bg-vx-selection text-vx-on-selection' : it.restorable ? 'hover:bg-vx-hover focus-within:bg-vx-hover' : '',
                      )}
                      data-collapsing={collapsing.has(k) ? 'true' : undefined}
                      title={it.restorable ? undefined : UNRESTORABLE}
                      onContextMenu={(e) => {
                        if (!it.restoreAt) return;
                        e.preventDefault();
                        setMenu({
                          at: { x: e.clientX, y: e.clientY },
                          items: [
                            { id: 'restore', label: 'Restore to original place', icon: <RotateCcw size={18} strokeWidth={1.75} />, tone: 'past', disabled: !it.restorable, reason: UNRESTORABLE, onSelect: () => void restoreMany([it]) },
                            { id: 'time', label: 'Show in time', icon: <Clock size={18} strokeWidth={1.75} />, onSelect: () => void showInTime(it) },
                          ],
                        });
                      }}
                    >
                      <span className={cx('flex justify-center', !on && !anySelected && 'vxv-reveal')}>
                        <Checkbox checked={on} disabled={!it.restorable} label={`Select ${basename(it.path)}`} onChange={() => toggle(k)} />
                      </span>
                      <span className="flex min-w-0 items-center gap-3">
                        <FileIcon name={basename(it.path)} type={it.type} size={20} muted={!it.restorable} />
                        <span className="flex min-w-0 flex-col">
                          <span className={cx('truncate text-[14px] font-medium leading-5', it.restorable ? (on ? '' : 'text-vx-text-1') : 'text-vx-text-4')} title={it.path}>
                            {basename(it.path) || it.path}
                          </span>
                          <span className={cx('vx-meta truncate min-[721px]:hidden', it.restorable ? 'text-vx-text-3' : 'text-vx-text-4')}>
                            <When at={it.deletedAt} friendly /> · {folderLabel}
                          </span>
                        </span>
                        {it.occupied ? (
                          <Badge tone="dashed" title="A different item has this name now; restoring asks before replacing it." className="max-[720px]:hidden">
                            Name in use
                          </Badge>
                        ) : null}
                      </span>
                      <span className="min-w-0 max-[900px]:hidden">
                        <button
                          type="button"
                          onClick={() => router.push(driveHref(folder))}
                          className={cx('vx-meta-row block max-w-full truncate rounded-vx-xs text-left hover:underline', it.restorable ? 'text-vx-text-3 hover:text-vx-text-1' : 'text-vx-text-4')}
                          title={`Open ${folderLabel}`}
                        >
                          {folderLabel}
                        </button>
                      </span>
                      <When at={it.deletedAt} friendly className={cx('vx-meta-row max-[720px]:hidden', it.restorable ? 'text-vx-text-3' : 'text-vx-text-4')} />
                      <span className="text-right max-[720px]:hidden">
                        {it.type === 'dir' && !it.size ? (
                          <span className="vx-meta-row text-vx-text-4">—</span>
                        ) : (
                          <Bytes n={it.size} className={cx('vx-meta-row', it.restorable ? 'text-vx-text-3' : 'text-vx-text-4')} />
                        )}
                      </span>
                      <span className="flex items-center justify-end gap-1">
                        {it.restorable ? (
                          <Button size="sm" variant="outline" loading={isBusy} className="max-[720px]:hidden" icon={<RotateCcw size={16} strokeWidth={1.75} aria-hidden className="text-vx-past" />} onClick={() => void restoreMany([it])}>
                            Restore
                          </Button>
                        ) : (
                          <Tooltip label={UNRESTORABLE}>
                            <span className="vx-micro text-vx-text-4 max-[720px]:hidden">Not recoverable</span>
                          </Tooltip>
                        )}
                        {it.restoreAt ? (
                          <IconButton size="sm" label={`More actions for ${basename(it.path)}`} onClick={(e) => moreMenu(it, e.currentTarget)}>
                            <Ellipsis size={18} strokeWidth={1.75} aria-hidden />
                          </IconButton>
                        ) : (
                          <span className="inline-block w-8" />
                        )}
                      </span>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}
