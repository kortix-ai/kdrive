'use client';

// Move to… / Copy to… (480 px): browse folders at "now", pick a destination.
// A name clash offers Keep both (renamed `name (1).ext`) or Replace.
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronRight, Folder } from 'lucide-react';
import { basename, dirname, nextFreeName, splitPath, type FileEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/components/ui/cx';
import { api } from '@/lib/api/endpoints';
import { moveItems } from '@/lib/drive/actions';
import { isSameOrInside } from '@/lib/drive/selection';
import { compareNames } from '@/lib/drive/sort';

export interface MoveCopyRequest {
  mode: 'move' | 'copy';
  entries: FileEntry[];
  /** Folder the picker opens at. */
  startDir: string;
  /** Pre-filled clash (a drag-and-drop move that hit existing names). */
  exists?: string[];
}

export default function MoveCopyDialog({
  ws,
  rootName,
  req,
  onClose,
}: {
  ws: string;
  rootName: string;
  req: MoveCopyRequest | null;
  onClose: () => void;
}) {
  if (!req) return null;
  return <MoveCopyInner key={`${req.mode}:${req.entries.map((e) => e.path).join('|')}`} ws={ws} rootName={rootName} req={req} onClose={onClose} />;
}

function MoveCopyInner({ ws, rootName, req, onClose }: { ws: string; rootName: string; req: MoveCopyRequest; onClose: () => void }) {
  const [dir, setDir] = useState(req.startDir);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState<string[] | null>(req.exists ?? null);
  const { data, error: listErr, isLoading } = useSWR(['ls', ws, dir, null], () => api.files.list(ws, { path: dir }), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const paths = req.entries.map((e) => e.path);
  const verb = req.mode === 'move' ? 'Move' : 'Copy';
  const what = req.entries.length === 1 ? req.entries[0].name : `${req.entries.length} items`;
  const folders = useMemo(
    () => (data?.entries ?? []).filter((e) => e.type === 'dir').sort((a, b) => compareNames(a.name, b.name)),
    [data],
  );
  const insideMoved = (p: string) => req.entries.some((e) => e.type === 'dir' && isSameOrInside(e.path, p));
  const sameParent = req.mode === 'move' && paths.every((p) => dirname(p) === dir);
  const invalid = insideMoved(dir) ? 'A folder cannot go inside itself.' : sameParent ? 'Already here.' : null;
  const destLabel = dir === '/' ? rootName : basename(dir);

  const run = async (opts: { overwrite?: boolean; keepBoth?: boolean } = {}) => {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    let renames: Map<string, string> | undefined;
    if (opts.keepBoth) {
      const listing = data ?? (await api.files.list(ws, { path: dir }).catch(() => null));
      const taken = new Set((listing?.entries ?? []).map((e) => e.name));
      renames = new Map();
      for (const e of req.entries) {
        const name = nextFreeName(e.name, taken);
        taken.add(name);
        if (name !== e.name) renames.set(e.path, name);
      }
    }
    const r = await moveItems(ws, paths, dir, { copy: req.mode === 'copy', overwrite: opts.overwrite, renames, quiet: true });
    setBusy(false);
    if (r.ok) onClose();
    else if ('exists' in r) setExists(r.exists);
    else setError(r.error);
  };

  const crumbs = [{ path: '/', label: rootName }, ...splitPath(dir).map((s, i, a) => ({ path: '/' + a.slice(0, i + 1).join('/'), label: s }))];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${verb} ${what}`}
      width={480}
      busy={busy}
      error={error}
      onSubmit={() => void run()}
      footer={
        <>
          <span className="vx-meta mr-auto truncate text-vx-text-3">
            to <span className="text-vx-text-1">{destLabel}</span>
          </span>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={busy && !exists} disabled={!!invalid || !!exists}>
            {verb} here
          </Button>
        </>
      }
    >
      <nav aria-label="Destination" className="mb-3 flex flex-wrap items-center">
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center">
            {i > 0 ? <span className="vx-ui px-1 text-vx-text-4">/</span> : null}
            <button
              type="button"
              onClick={() => {
                setDir(c.path);
                setExists(null);
              }}
              className={cx('vx-ui', i === crumbs.length - 1 ? 'text-vx-text-1' : 'text-vx-text-3 hover:text-vx-text-1')}
            >
              {c.label}
            </button>
          </span>
        ))}
      </nav>
      <div className="h-[260px] overflow-auto border border-vx-hair">
        {isLoading && !data ? (
          <div className="space-y-2 p-3">
            <span className="skeleton skel-line w-40" />
            <span className="skeleton skel-line w-32" />
            <span className="skeleton skel-line w-36" />
          </div>
        ) : listErr ? (
          <p className="vx-meta p-3 text-vx-danger">Couldn't list this folder.</p>
        ) : folders.length ? (
          <ul role="listbox" aria-label="Folders">
            {folders.map((f) => {
              const blocked = insideMoved(f.path);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    disabled={blocked}
                    title={blocked ? 'A folder cannot go inside itself.' : undefined}
                    onClick={() => {
                      setDir(f.path);
                      setExists(null);
                    }}
                    className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-vx-surface-2 disabled:opacity-40"
                  >
                    <Folder size={16} strokeWidth={1.5} className="text-vx-text-2" aria-hidden />
                    <span className="vx-name flex-1 truncate text-vx-text-1">{f.name}</span>
                    <ChevronRight size={14} className="text-vx-text-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="vx-meta p-3 text-vx-text-4">No folders in here.</p>
        )}
      </div>
      {invalid ? <p className="vx-meta mt-2 text-vx-text-4">{invalid}</p> : null}
      {exists ? (
        <div className="mt-3 flex items-center gap-2 border-l-2 border-vx-danger py-1 pl-3">
          <span className="vx-meta flex-1 text-vx-text-2">
            {exists.length === 1 ? `${basename(exists[0])} already exists in ${destLabel}.` : `${exists.length} items already exist in ${destLabel}.`}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void run({ overwrite: true })} disabled={busy}>
            Replace
          </Button>
          <Button size="sm" variant="primary" onClick={() => void run({ keepBoth: true })} loading={busy}>
            Keep both
          </Button>
        </div>
      ) : null}
      <p className="vx-meta mt-3 text-vx-text-4">
        {req.mode === 'move' ? 'Moving' : 'Copying'} makes one new version. You can undo it.
      </p>
    </Dialog>
  );
}
