'use client';

// Breadcrumbs (DESIGN-v2 §6.2): 36 px pill crumbs in 22/600. Ancestors are text-3 with a
// ChevronRight between them; the current crumb is text-1 with a ChevronDown that opens the
// folder menu. More than 4 levels collapse into a `…` crumb menu. Every crumb is a drop
// target for moving items.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { splitPath } from '@volumes/shared';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { cx } from '@/components/ui/cx';
import { isInternalDrag } from '@/lib/drive/selection';

export interface Crumb {
  path: string;
  label: string;
}

export function crumbsFor(path: string, rootName: string): Crumb[] {
  const segs = splitPath(path);
  return [{ path: '/', label: rootName }, ...segs.map((s, i) => ({ path: '/' + segs.slice(0, i + 1).join('/'), label: s }))];
}

const crumbBase =
  'inline-flex h-9 min-w-0 shrink items-center gap-1 rounded-full px-3 text-[22px] font-semibold leading-7 tracking-[-0.02em] transition-colors duration-[120ms] ease-vx';

function Sep() {
  return <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-vx-text-4" aria-hidden />;
}

export default function Breadcrumbs({
  path,
  rootName,
  past,
  onNavigate,
  onDropItems,
  canDropInto,
  folderMenu,
}: {
  path: string;
  rootName: string;
  past: boolean;
  onNavigate: (path: string) => void;
  /** Internal drag dropped on a crumb. */
  onDropItems: (dest: string) => void;
  /** Whether the current internal drag may land in `dest`. */
  canDropInto: (dest: string) => boolean;
  /** Items of the current crumb's ▾ menu. */
  folderMenu: MenuItem[];
}) {
  const all = crumbsFor(path, rootName);
  const [over, setOver] = useState<string | null>(null);
  const collapsed = all.length > 4;
  const shown = collapsed ? [all[0], ...all.slice(-2)] : all;
  const hidden = collapsed ? all.slice(1, -2) : [];

  const dropProps = (c: Crumb) => ({
    'data-vx-drop-dir': past ? undefined : c.path,
    onDragOver: (e: React.DragEvent) => {
      if (past || !isInternalDrag(e.dataTransfer) || !canDropInto(c.path)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(c.path);
    },
    onDragLeave: () => setOver((o) => (o === c.path ? null : o)),
    onDrop: (e: React.DragEvent) => {
      if (past || !isInternalDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      if (canDropInto(c.path)) onDropItems(c.path);
    },
  });
  const dropTone = (c: Crumb) => over === c.path && 'bg-vx-accent-wash text-vx-on-accent-wash shadow-[inset_0_0_0_2px_var(--vx-accent-edge)]';

  const ancestor = (c: Crumb) => (
    <li key={c.path} className="flex min-w-0 shrink items-center">
      <button
        type="button"
        {...dropProps(c)}
        onClick={() => onNavigate(c.path)}
        title={c.path === '/' ? rootName : c.path}
        className={cx(crumbBase, 'max-w-[200px] text-vx-text-3 hover:bg-vx-hover hover:text-vx-text-1', dropTone(c))}
      >
        <span className="truncate">{c.label}</span>
      </button>
      <Sep />
    </li>
  );

  const last = shown[shown.length - 1];
  return (
    <nav aria-label="Folder path" className="min-w-0">
      <ol className="flex min-w-0 items-center">
        {shown.length > 1 ? ancestor(shown[0]) : null}
        {collapsed ? (
          <li className="flex shrink-0 items-center">
            <Menu
              items={hidden.map((h) => ({ id: h.path, label: h.label, onSelect: () => onNavigate(h.path) }))}
              trigger={(p) => (
                <button type="button" {...p} aria-label="Show hidden folders" className={cx(crumbBase, 'text-vx-text-3 hover:bg-vx-hover hover:text-vx-text-1')}>
                  …
                </button>
              )}
            />
            <Sep />
          </li>
        ) : null}
        {shown.slice(1, -1).map(ancestor)}
        <li className="flex min-w-0 items-center">
          <Menu
            items={folderMenu}
            trigger={(p) => (
              <button
                type="button"
                {...p}
                {...dropProps(last)}
                aria-current="page"
                aria-label={`${last.label}: folder actions`}
                title={last.path === '/' ? rootName : last.path}
                className={cx(crumbBase, 'pr-2 text-vx-text-1 hover:bg-vx-hover', dropTone(last))}
              >
                <span className="truncate">{last.label}</span>
                <ChevronDown size={18} strokeWidth={1.75} className="shrink-0 text-vx-text-2" aria-hidden />
              </button>
            )}
          />
        </li>
      </ol>
    </nav>
  );
}
