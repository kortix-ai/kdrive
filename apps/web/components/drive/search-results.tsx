'use client';

// Result rows for the search palette: glyph, name with the matched run in
// text-1 (rest text-3), parent path, size, modified. Plus the GO TO rows.
import { Clock } from 'lucide-react';
import { dirname, formatBytes, shortId, type FileEntry } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { formatRelative, formatTimeTravelLabel } from '@/lib/format';
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
            className={cx('flex h-9 w-full items-center gap-3 px-4 text-left', on ? 'bg-vx-surface-2' : '')}
          >
            <Clock size={16} strokeWidth={1.5} className="text-vx-past" aria-hidden />
            <span className="vx-name min-w-0 flex-1 truncate text-vx-text-1">
              {it.label === 'nearest' ? `Go to ${formatTimeTravelLabel(e.createdAt)} (nearest version)` : `Go to ${shortId(e.commitId)} · ${formatTimeTravelLabel(e.createdAt)}`}
            </span>
            <span className="vx-meta max-w-[40%] truncate text-vx-text-3">{e.isHead ? 'now' : e.summary}</span>
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
          className={cx('grid h-9 w-full items-center gap-3 px-4 text-left', on ? 'bg-vx-surface-2' : '')}
          style={{ gridTemplateColumns: '16px minmax(0, 1fr) minmax(0, 36%) 72px 72px' }}
        >
          <FileIcon name={e.name} type={e.type} />
          <span className="vx-name truncate text-vx-text-3">
            {a}
            <span className="text-vx-text-1">{m}</span>
            {b}
          </span>
          <span className="vx-meta truncate text-vx-text-3" title={parent}>
            {parent === '/' ? rootName : parent}
          </span>
          <span className="vx-meta truncate text-right text-vx-text-3">{e.type === 'dir' ? '—' : formatBytes(e.size)}</span>
          <span className="vx-meta truncate text-right text-vx-text-3">{e.mtime ? formatRelative(e.mtime) : '—'}</span>
        </button>
      </li>
    );
  };
  return (
    <ul role="listbox" aria-label="Search results" className="py-1">
      {gotos.length ? (
        <>
          <li className="vx-label px-4 pb-1 pt-2" role="presentation">
            Go to
          </li>
          {gotos.map(row)}
        </>
      ) : null}
      {files.length ? (
        <>
          {gotos.length ? (
            <li className="vx-label px-4 pb-1 pt-3" role="presentation">
              Files
            </li>
          ) : null}
          {files.map(row)}
        </>
      ) : null}
    </ul>
  );
}
