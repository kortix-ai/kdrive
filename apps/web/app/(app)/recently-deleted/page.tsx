'use client';

// /recently-deleted — deleted items that can still come back (DESIGN.md §6.10).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, RotateCcw } from 'lucide-react';
import { basename, dirname, type DeletedItem } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
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
      registerUndo({ label, actionId: r.action.id });
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-vx-hair px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="vx-h1">Recently deleted</h1>
          {restorableSel.length ? (
            <Button variant="restore" onClick={() => void restoreMany(restorableSel)} loading={restorableSel.some((it) => busy.has(keyOf(it)))}>
              Restore {restorableSel.length} {restorableSel.length === 1 ? 'item' : 'items'}
            </Button>
          ) : null}
        </div>
        <p className="vx-body mt-3 max-w-[640px] text-vx-text-3">Items stay recoverable while the version before the delete is kept.</p>
        <RetentionNote className="mt-1" />
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-6 py-3" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-9 items-center gap-4 border-b border-vx-hair-soft">
                <span className="skeleton skel-line w-48" />
                <span className="skeleton skel-line w-32" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState title="Couldn't load deleted items." body={errorText(error)} actions={<Button onClick={() => void mutate()}>Retry</Button>} />
        ) : !items.length ? (
          <EmptyState title="Nothing deleted." body="Deleted items stay here while their history is kept." />
        ) : (
          <div role="list" aria-label="Deleted items" className="min-w-[680px]">
            <div className="grid h-8 grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_128px_96px_132px] items-center border-b border-vx-hair bg-vx-surface-2 pr-4">
              <span className="flex justify-center">
                <Check
                  checked={items.length > 0 && items.every((it) => !it.restorable || selected.has(keyOf(it)))}
                  indeterminate={selected.size > 0}
                  label="Select all restorable items"
                  onChange={(on) => setSelected(on ? new Set(items.filter((it) => it.restorable).map(keyOf)) : new Set())}
                />
              </span>
              <span className="vx-label">Name</span>
              <span className="vx-label">Original folder</span>
              <span className="vx-label">Deleted</span>
              <span className="vx-label text-right">Size</span>
              <span />
            </div>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="pt-band vx-label h-8 px-6">{g.label}</div>
                {g.items.map((it) => {
                  const k = keyOf(it);
                  const isBusy = busy.has(k);
                  const row = (
                    <div
                      role="listitem"
                      className={cx(
                        'vxv-collapse group grid h-9 grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_128px_96px_132px] items-center border-b border-vx-hair-soft pr-4',
                        it.restorable ? 'hover:bg-vx-surface-2' : 'text-vx-text-4',
                        selected.has(k) && 'bg-vx-accent-wash shadow-[inset_2px_0_0_var(--vx-accent-edge)]',
                      )}
                      data-collapsing={collapsing.has(k) ? 'true' : undefined}
                      title={it.restorable ? undefined : UNRESTORABLE}
                      onContextMenu={(e) => {
                        if (!it.restoreAt) return;
                        e.preventDefault();
                        setMenu({
                          at: { x: e.clientX, y: e.clientY },
                          items: [
                            { id: 'restore', label: 'Restore to original place', icon: <RotateCcw size={14} />, disabled: !it.restorable, reason: UNRESTORABLE, onSelect: () => void restoreMany([it]) },
                            { id: 'time', label: 'Show in time', icon: <Clock size={14} />, onSelect: () => void showInTime(it) },
                          ],
                        });
                      }}
                    >
                      <span className="flex justify-center">
                        <Check checked={selected.has(k)} disabled={!it.restorable} label={`Select ${basename(it.path)}`} onChange={() => toggle(k)} />
                      </span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <FileIcon name={basename(it.path)} type={it.type} className={it.restorable ? undefined : 'text-vx-text-4'} />
                        <span className={cx('vx-name truncate', it.restorable ? 'text-vx-text-1' : 'text-vx-text-4')} title={it.path}>
                          {basename(it.path) || it.path}
                        </span>
                        {it.occupied ? (
                          <span className="vx-micro shrink-0 text-vx-text-3" title="A different item has this name now; restoring asks before replacing it.">
                            name in use
                          </span>
                        ) : null}
                      </span>
                      <span className={cx('vx-meta truncate', it.restorable ? 'text-vx-text-3' : 'text-vx-text-4')} title={dirname(it.path)}>
                        {dirname(it.path)}
                      </span>
                      <When at={it.deletedAt} className={cx('vx-meta', it.restorable ? 'text-vx-text-3' : 'text-vx-text-4')} />
                      <span className="text-right">
                        {it.type === 'dir' && !it.size ? (
                          <span className="vx-meta text-vx-text-4">—</span>
                        ) : (
                          <Bytes n={it.size} className={cx('vx-meta', it.restorable ? 'text-vx-text-3' : 'text-vx-text-4')} />
                        )}
                      </span>
                      <span className="flex items-center justify-end gap-1">
                        {it.restorable ? (
                          <Button size="sm" variant="secondary" loading={isBusy} onClick={() => void restoreMany([it])}>
                            ↺ Restore
                          </Button>
                        ) : (
                          <span className="vx-micro text-vx-text-4">Not recoverable</span>
                        )}
                        {it.restoreAt ? (
                          <button
                            type="button"
                            aria-label={`More actions for ${basename(it.path)}`}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setMenu({
                                at: { x: r.right - 220, y: r.bottom + 4 },
                                items: [{ id: 'time', label: 'Show in time', icon: <Clock size={14} />, onSelect: () => void showInTime(it) }],
                              });
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-3 hover:text-vx-text-1"
                          >
                            ⋯
                          </button>
                        ) : (
                          <span className="inline-block w-7" />
                        )}
                      </span>
                    </div>
                  );
                  return <div key={k}>{row}</div>;
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

function Check({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  const on = checked;
  const mixed = !on && indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        'inline-flex h-3.5 w-3.5 items-center justify-center border font-mono text-[10px] leading-none disabled:opacity-40',
        on || mixed ? 'border-pt-100 bg-pt-100 text-vx-text-inv' : 'border-vx-hair-strong hover:border-vx-text-3',
      )}
    >
      {on ? '✓' : mixed ? '—' : ''}
    </button>
  );
}
