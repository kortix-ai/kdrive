'use client';

// Breadcrumbs (DESIGN §6.2): mono segments, `/` separators in text-4, the
// current crumb in text-1, more than 4 levels collapse into a `…` menu. Every
// crumb is a drop target (dashed underline) for moving items and uploads.
import { useState } from 'react';
import { splitPath } from '@volumes/shared';
import { Menu } from '@/components/ui/menu';
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

export default function Breadcrumbs({
  path,
  rootName,
  past,
  onNavigate,
  onDropItems,
  canDropInto,
}: {
  path: string;
  rootName: string;
  past: boolean;
  onNavigate: (path: string) => void;
  /** Internal drag dropped on a crumb. */
  onDropItems: (dest: string) => void;
  /** Whether the current internal drag may land in `dest`. */
  canDropInto: (dest: string) => boolean;
}) {
  const all = crumbsFor(path, rootName);
  const [over, setOver] = useState<string | null>(null);
  const collapsed = all.length > 5;
  const shown = collapsed ? [all[0], ...all.slice(-3)] : all;
  const hidden = collapsed ? all.slice(1, -3) : [];

  const crumb = (c: Crumb, i: number, isLast: boolean) => (
    <li key={c.path} className="flex min-w-0 items-center">
      {i > 0 ? (
        <span className="vx-ui px-1.5 text-vx-text-4" aria-hidden>
          /
        </span>
      ) : null}
      <button
        type="button"
        data-vx-drop-dir={past ? undefined : c.path}
        aria-current={isLast ? 'page' : undefined}
        onClick={() => !isLast && onNavigate(c.path)}
        onDragOver={(e) => {
          if (past || !isInternalDrag(e.dataTransfer) || !canDropInto(c.path)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOver(c.path);
        }}
        onDragLeave={() => setOver((o) => (o === c.path ? null : o))}
        onDrop={(e) => {
          if (past || !isInternalDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          if (canDropInto(c.path)) onDropItems(c.path);
        }}
        title={c.path === '/' ? rootName : c.path}
        className={cx(
          'vx-ui max-w-[220px] truncate border-b py-0.5 transition-colors duration-[120ms]',
          isLast ? 'cursor-default text-vx-text-1' : 'text-vx-text-3 hover:text-vx-text-1',
          over === c.path ? 'border-dashed border-vx-accent-edge text-vx-text-1' : 'border-transparent',
        )}
      >
        {c.label}
      </button>
    </li>
  );

  return (
    <nav aria-label="Folder path" className="min-w-0">
      <ol className="flex min-w-0 items-center">
        {crumb(shown[0], 0, shown.length === 1)}
        {collapsed ? (
          <li className="flex items-center">
            <span className="vx-ui px-1.5 text-vx-text-4" aria-hidden>
              /
            </span>
            <Menu
              items={hidden.map((h) => ({ id: h.path, label: h.label, onSelect: () => onNavigate(h.path) }))}
              trigger={(p) => (
                <button type="button" {...p} aria-label="Show hidden folders" className="vx-ui px-1 text-vx-text-3 hover:text-vx-text-1">
                  …
                </button>
              )}
            />
          </li>
        ) : null}
        {shown.slice(1).map((c, i) => crumb(c, collapsed ? i + 2 : i + 1, i === shown.length - 2))}
      </ol>
    </nav>
  );
}
