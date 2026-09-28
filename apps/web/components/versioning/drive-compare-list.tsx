'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { basename, type DriveChange } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { compareHref } from '@/lib/urls';
import { Bytes, Delta } from './readout';

/** Section order and the status letter at each row's end (`+` added, `M` changed, `R` moved, `−` removed). */
const BANDS: { op: DriveChange['op']; label: string; letter: string; name: string }[] = [
  { op: 'added', label: 'Added', letter: '+', name: 'added' },
  { op: 'changed', label: 'Changed', letter: 'M', name: 'changed' },
  { op: 'moved', label: 'Moved', letter: 'R', name: 'moved' },
  { op: 'removed', label: 'Removed', letter: '−', name: 'removed' },
];

const byPath = (x: DriveChange, y: DriveChange) => x.path.localeCompare(y.path, undefined, { numeric: true, sensitivity: 'base' });

/** Grouped drive changes between A (older) and B (newer): Added · Changed · Moved · Removed (DESIGN-v2 §6.7). */
export function DriveCompareList({ changes, a, b }: { changes: DriveChange[]; a: string; b: string }) {
  return (
    <div className="px-2 pb-4">
      {BANDS.map((band) => {
        const rows = changes.filter((c) => c.op === band.op).sort(byPath);
        if (!rows.length) return null;
        return (
          <section key={band.op} aria-label={band.label}>
            <div className="sticky top-0 z-[1] flex items-center gap-2 bg-vx-surface px-3 pb-2 pt-5">
              <span className="vx-eyebrow">{band.label}</span>
              <span className="inline-flex h-5 items-center rounded-full bg-vx-surface-3 px-2 text-[11px] font-semibold leading-4 tabular-nums text-vx-text-2">
                {rows.length.toLocaleString('en-US')}
              </span>
            </div>
            <ul>
              {rows.map((c) => (
                <li key={`${c.op}:${c.fromPath ?? ''}:${c.path}`}>
                  <Row c={c} letter={band.letter} status={band.name} a={a} b={b} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Row({ c, letter, status, a, b }: { c: DriveChange; letter: string; status: string; a: string; b: string }) {
  const linkable = c.op === 'changed' && c.type === 'file';
  const size =
    c.op === 'added' ? (
      c.type === 'dir' ? null : <Delta n={c.sizeB ?? 0} />
    ) : c.op === 'removed' ? (
      c.type === 'dir' ? null : (
        <span className="text-vx-text-3">
          −<Bytes n={c.sizeA ?? null} />
        </span>
      )
    ) : c.sizeA !== undefined && c.sizeB !== undefined && c.type === 'file' ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-vx-text-3 max-[720px]:hidden">
          <Bytes n={c.sizeA} /> → <Bytes n={c.sizeB} />
        </span>
        <Delta n={c.sizeB - c.sizeA} />
      </span>
    ) : null;
  const inner = (
    <>
      <FileIcon name={basename(c.path)} type={c.type} size={20} />
      <span
        className={cx('min-w-0 flex-1 truncate text-[14px] leading-5', c.op === 'removed' ? 'text-vx-text-3' : 'text-vx-text-1')}
        title={c.fromPath ? `${c.fromPath} → ${c.path}` : c.path}
      >
        {c.fromPath ? (
          <>
            <span className="text-vx-text-3">{c.fromPath}</span>
            <span className="px-1.5 text-vx-text-4" aria-label="moved to">
              →
            </span>
            <span className="font-medium">{c.path}</span>
          </>
        ) : (
          <span className="font-medium">{c.path}</span>
        )}
        {c.type === 'dir' ? <span className="text-vx-text-4">/</span> : null}
      </span>
      <span className="vx-meta-row shrink-0 text-right">{size}</span>
      {linkable ? (
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-4 transition-colors group-hover:text-vx-text-2" />
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <span className="w-4 shrink-0 text-center font-mono text-[12px] text-vx-text-4" title={status} aria-label={status}>
        {letter}
      </span>
    </>
  );
  const cls = 'group flex h-10 items-center gap-3 rounded-vx-sm px-3 transition-colors duration-[120ms]';
  return linkable ? (
    <Link href={compareHref(c.path, a, b)} className={cx(cls, 'vx-inset-focus hover:bg-vx-hover')} aria-label={`Compare ${c.path}`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default DriveCompareList;
