'use client';

// Move to… / Copy to… (480 px): browse folders at "now", pick a destination.
// A name clash offers Keep both (renamed `name (1).ext`) or Replace.
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronRight } from 'lucide-react';
import { basename, dirname, nextFreeName, splitPath, type FileEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
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
          <span className="vx-meta mr-auto min-w-0 truncate text-vx-text-3 max-[720px]:mr-0 max-[720px]:text-center">
            to <span className="font-medium text-vx-text-1">{destLabel}</span>
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
      <nav aria-label="Destination" className="-ml-2 mb-2 flex flex-wrap items-center">
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex min-w-0 items-center">
            {i > 0 ? <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-4" aria-hidden /> : null}
            <button
              type="button"
              aria-current={i === crumbs.length - 1 ? 'location' : undefined}
              onClick={() => {
                setDir(c.path);
                setExists(null);
              }}
              className={cx(
                'inline-flex h-8 max-w-[180px] items-center truncate rounded-full px-2 text-[14px] font-medium leading-5 transition-colors duration-[120ms] hover:bg-vx-hover',
                i === crumbs.length - 1 ? 'text-vx-text-1' : 'text-vx-text-3 hover:text-vx-text-1',
              )}
            >
              <span className="truncate">{c.label}</span>
            </button>
          </span>
        ))}
      </nav>
      <div className="h-[260px] overflow-auto rounded-vx-md bg-vx-surface-2 p-1">
        {isLoading && !data ? (
          <div className="space-y-2 p-3">
            <span className="skeleton skel-line w-40" />
            <span className="skeleton skel-line w-32" />
            <span className="skeleton skel-line w-36" />
          </div>
        ) : listErr ? (
          <p className="vx-meta p-3 text-vx-del-fg">Couldn't list this folder.</p>
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
                    className="vx-inset-focus flex h-10 w-full items-center gap-3 rounded-vx-sm px-3 text-left transition-colors duration-[120ms] hover:bg-vx-hover disabled:cursor-not-allowed disabled:opacity-[.38]"
                  >
                    <FileIcon name={f.name} type="dir" size={24} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-vx-text-1">{f.name}</span>
                    <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-vx-text-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="vx-meta p-3 text-vx-text-3">No folders in here.</p>
        )}
      </div>
      {invalid ? <p className="vx-meta mt-2 text-vx-text-3">{invalid}</p> : null}
      {exists ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-vx-md bg-vx-danger-wash px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--vx-danger-edge)]" role="alert">
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-5 text-vx-text-1">
              {exists.length === 1 ? `${basename(exists[0])} already exists in ${destLabel}.` : `${exists.length} items already exist in ${destLabel}.`}
            </span>
            <span className="vx-meta block text-vx-text-2">Replace keeps the old one in history.</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void run({ overwrite: true })} disabled={busy}>
              Replace
            </Button>
            <Button size="sm" variant="tonal" onClick={() => void run({ keepBoth: true })} loading={busy}>
              Keep both
            </Button>
          </span>
        </div>
      ) : null}
      <p className="vx-meta mt-3 text-vx-text-3">
        {req.mode === 'move' ? 'Moving' : 'Copying'} makes one new version. You can undo it.
      </p>
    </Dialog>
  );
}
