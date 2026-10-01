'use client';

// Result rows for the search palette (UNIFY-SPEC §14.2): 40 px, r4; type icon, the name
// with the matched run in text-1 600 (the rest text-2), Mono parent path, size, modified. Plus
// the `Go to` rows (Clock) that jump in time.
import { Clock } from 'lucide-react';
import { dirname, formatBytes, shortId, type FileEntry } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { formatRelative, formatMoment } from '@/lib/format';
import type { GoToEntry } from '@/lib/drive/goto';

/** Splits `name` around the first case-insensitive occurrence of `q`. */
export function splitMatch(name: string, q: string): [string, string, string] {
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return [name, '', ''];
  return [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)];
}

export type PaletteItem = { kind: 'file'; entry: FileEntry } | { kind: 'goto'; entry: GoToEntry; label: 'commit' | 'nearest' };

export function paletteItemId(it: PaletteItem): string {
  return it.kind === 'file' ? `f:${it.entry.path}` : `g:${it.entry.commitId}`;
}

export default function SearchResults({
  items,
  query,
  active,
  onHover,
  onPick,
  rootName,
}: {
  items: PaletteItem[];
  query: string;
  active: number;
  onHover: (i: number) => void;
  onPick: (it: PaletteItem, reveal: boolean) => void;
  rootName: string;
}) {
  const gotos = items.filter((i) => i.kind === 'goto');
  const files = items.filter((i) => i.kind === 'file');
  const row = (it: PaletteItem) => {
    const idx = items.indexOf(it);
    const on = idx === active;
    const id = `vx-sr-${idx}`;
    if (it.kind === 'goto') {
      const e = it.entry;
      return (
        <li key={paletteItemId(it)} id={id} role="option" aria-selected={on}>
          <button
            type="button"
            tabIndex={-1}
            onMouseMove={() => onHover(idx)}
            onClick={(ev) => onPick(it, ev.metaKey || ev.ctrlKey)}
            className={cx('flex h-10 w-full items-center gap-3 rounded-vx-sm px-3 text-left transition-colors duration-[120ms]', on && 'bg-vx-raise')}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              <Clock size={16} strokeWidth={1.75} className="text-vx-past" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-vx-text-1">
              {it.label === 'nearest' ? `Go to ${formatMoment(e.createdAt)} (nearest version)` : `Go to ${shortId(e.commitId)} · ${formatMoment(e.createdAt)}`}
            </span>
            <span className="vx-meta-row max-w-[40%] truncate text-vx-text-3">{e.isHead ? 'Now' : e.summary}</span>
          </button>
        </li>
      );
    }
    const e = it.entry;
    const [a, m, b] = splitMatch(e.name, query);
    const parent = dirname(e.path);
    return (
      <li key={paletteItemId(it)} id={id} role="option" aria-selected={on}>
        <button
          type="button"
          tabIndex={-1}
          onMouseMove={() => onHover(idx)}
          onClick={(ev) => onPick(it, ev.metaKey || ev.ctrlKey)}
          className={cx(
            'grid h-10 w-full items-center gap-3 rounded-vx-sm px-3 text-left transition-colors duration-[120ms]',
            'grid-cols-[20px_minmax(0,1fr)_minmax(0,32%)_72px_96px] max-[720px]:grid-cols-[20px_minmax(0,1fr)_minmax(0,36%)]',
            on && 'bg-vx-raise',
          )}
        >
          <FileIcon name={e.name} type={e.type} size={20} />
          <span className="truncate text-[14px] font-medium leading-5 text-vx-text-2">
            {a}
            <span className="font-semibold text-vx-text-1">{m}</span>
            {b}
          </span>
          <span className="vx-meta truncate text-vx-text-3" title={parent}>
            {[rootName, ...parent.split('/').filter(Boolean)].join(' / ')}
          </span>
          <span className="vx-meta-row truncate text-right text-vx-text-3 max-[720px]:hidden">{e.type === 'dir' ? '—' : formatBytes(e.size)}</span>
          <span className="vx-meta-row truncate text-right text-vx-text-3 max-[720px]:hidden">{e.mtime ? formatRelative(e.mtime) : '—'}</span>
        </button>
      </li>
    );
  };
  return (
    <ul role="listbox" aria-label="Search results" className="px-2 py-2">
      {gotos.length ? (
        <>
          <li className="vx-eyebrow px-3 pb-1.5 pt-1" role="presentation">
            Go to
          </li>
          {gotos.map(row)}
        </>
      ) : null}
      {files.length ? (
        <>
          {gotos.length ? (
            <li className="vx-eyebrow px-3 pb-1.5 pt-3" role="presentation">
              Files
            </li>
          ) : null}
          {files.map(row)}
        </>
      ) : null}
    </ul>
  );
}
