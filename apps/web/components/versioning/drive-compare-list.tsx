'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { basename, type DriveChange } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { compareHref } from '@/lib/urls';
import { MiddleName } from '@/components/drive/file-row';
import { ChangeTag } from './change-kind';
import { Bytes, Delta } from './readout';

/** Section order; each row ends in the shared change sign (`+` added, `M` changed, `R` moved, `−` removed). */
const BANDS: { op: DriveChange['op']; label: string }[] = [
  { op: 'added', label: 'Added' },
  { op: 'changed', label: 'Changed' },
  { op: 'moved', label: 'Moved' },
  { op: 'removed', label: 'Removed' },
];

const byPath = (x: DriveChange, y: DriveChange) => x.path.localeCompare(y.path, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Grouped drive changes between A (older) and B (newer): Added · Changed · Moved · Removed (UNIFY-SPEC §12.1, §12.4).
 * Eyebrow group heads with Mono counts; full-bleed 36 px rows on hair-soft dividers; Mono status letters at the end.
 */
export function DriveCompareList({ changes, a, b }: { changes: DriveChange[]; a: string; b: string }) {
  return (
    <div className="pb-4">
      {BANDS.map((band) => {
        const rows = changes.filter((c) => c.op === band.op).sort(byPath);
        if (!rows.length) return null;
        return (
          <section key={band.op} aria-label={band.label}>
            <div className="sticky top-0 z-[1] flex h-9 items-end gap-2 border-b border-vx-hair bg-vx-surface px-4 pb-2 max-[720px]:px-3">
              <span className="vx-eyebrow">{band.label}</span>
              <span className="font-mono text-[11px] leading-4 tabular-nums text-vx-text-3">{rows.length.toLocaleString('en-US')}</span>
            </div>
            <ul>
              {rows.map((c) => (
                <li key={`${c.op}:${c.fromPath ?? ''}:${c.path}`}>
                  <Row c={c} a={a} b={b} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Row({ c, a, b }: { c: DriveChange; a: string; b: string }) {
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
        className={cx(
          'flex min-w-0 flex-1 items-center text-[14px] leading-5',
          c.fromPath && 'max-[720px]:flex-col max-[720px]:items-stretch',
          c.op === 'removed' ? 'text-vx-text-3 line-through decoration-vx-del-fg' : 'text-vx-text-1',
        )}
        title={c.fromPath ? `${c.fromPath} → ${c.path}` : c.path}
      >
        {c.fromPath ? (
          <>
            {/* Phones: two lines, where it was (text-3) over where it went. */}
            <PathName path={c.fromPath} dir={c.type === 'dir'} plain className="text-vx-text-3 min-[721px]:max-w-[45%]" />
            <span className="flex min-w-0 items-center">
              <span className="shrink-0 px-1.5 text-vx-text-3 max-[720px]:pl-0" aria-label="moved to">
                →
              </span>
              <PathName path={c.path} dir={c.type === 'dir'} />
            </span>
          </>
        ) : (
          <PathName path={c.path} dir={c.type === 'dir'} />
        )}
      </span>
      <span className="vx-meta-row shrink-0 text-right">{size}</span>
      {linkable ? (
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-4 transition-colors group-hover:text-vx-text-2" />
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <ChangeTag kind={c.op} className="min-w-[64px] justify-center" />
    </>
  );
  const cls = cx(
    'group flex min-h-9 items-center gap-3 border-b border-vx-hair-soft px-4 transition-colors duration-[120ms] max-[720px]:px-3',
    c.fromPath && 'max-[720px]:py-1.5',
  );
  return linkable ? (
    <Link href={compareHref(c.path, a, b)} className={cx(cls, 'vx-inset-focus hover:bg-vx-raise')} aria-label={`Compare ${c.path}`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * A path that keeps its file name when space runs out: the folders ellipsize first, then the name
 * middle-truncates, so the extension and the distinguishing tail survive.
 */
function PathName({ path, dir, plain, className }: { path: string; dir?: boolean; plain?: boolean; className?: string }) {
  const cut = path.lastIndexOf('/');
  const folder = cut >= 0 ? path.slice(0, cut + 1) : '';
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  return (
    <span className={cx('flex min-w-0', className)}>
      {folder ? (
        <span className={cx('shrink overflow-hidden text-ellipsis whitespace-pre text-vx-text-3', folder.length > 3 && 'min-w-[3ch]')}>{folder}</span>
      ) : null}
      {/* The name keeps its full width until the folders are down to "/…"; only then does it middle-truncate. */}
      <MiddleName name={name + (dir ? '/' : '')} className={cx('shrink-0', folder.length > 3 ? 'max-w-[calc(100%-3ch)]' : 'max-w-full', !plain && 'font-medium')} />
    </span>
  );
}

export default DriveCompareList;
