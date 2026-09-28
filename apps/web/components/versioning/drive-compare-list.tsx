'use client';

import Link from 'next/link';
import { basename, type DriveChange } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { compareHref } from '@/lib/urls';
import { Bytes, Delta } from './readout';

const BANDS: { op: DriveChange['op']; label: string; glyph: string; tone: string }[] = [
  { op: 'added', label: 'Added', glyph: '+', tone: 'text-vx-ok' },
  { op: 'changed', label: 'Changed', glyph: '~', tone: 'text-vx-text-2' },
  { op: 'moved', label: 'Moved', glyph: '→', tone: 'text-vx-text-2' },
  { op: 'removed', label: 'Removed', glyph: '−', tone: 'text-vx-danger' },
];

const byPath = (x: DriveChange, y: DriveChange) => x.path.localeCompare(y.path, undefined, { numeric: true, sensitivity: 'base' });

/** Grouped drive changes between A (older) and B (newer): Added · Changed · Moved · Removed. */
export function DriveCompareList({ changes, a, b }: { changes: DriveChange[]; a: string; b: string }) {
  return (
    <div>
      {BANDS.map((band) => {
        const rows = changes.filter((c) => c.op === band.op).sort(byPath);
        if (!rows.length) return null;
        return (
          <section key={band.op} aria-label={band.label}>
            <div className="pt-band vx-label sticky top-0 z-[1] h-8 bg-vx-bg px-6">
              <span>
                {band.label} <span className="text-vx-text-4">{rows.length.toLocaleString('en-US')}</span>
              </span>
            </div>
            <ul>
              {rows.map((c) => (
                <li key={`${c.op}:${c.fromPath ?? ''}:${c.path}`}>
                  <Row c={c} glyph={band.glyph} tone={band.tone} a={a} b={b} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Row({ c, glyph, tone, a, b }: { c: DriveChange; glyph: string; tone: string; a: string; b: string }) {
  const linkable = c.op === 'changed' && c.type === 'file';
  const size =
    c.op === 'added' ? (
      <Bytes n={c.type === 'dir' ? null : (c.sizeB ?? null)} />
    ) : c.op === 'removed' ? (
      <Bytes n={c.type === 'dir' ? null : (c.sizeA ?? null)} />
    ) : c.sizeA !== undefined && c.sizeB !== undefined && c.type === 'file' ? (
      <span className="inline-flex items-center gap-2">
        <span className="text-vx-text-4">
          <Bytes n={c.sizeA} /> → <Bytes n={c.sizeB} />
        </span>
        <Delta n={c.sizeB - c.sizeA} />
      </span>
    ) : (
      <span className="text-vx-text-4">—</span>
    );
  const inner = (
    <>
      <span className={cx('w-4 shrink-0 text-center font-mono text-[12px]', tone)} aria-hidden>
        {glyph}
      </span>
      <FileIcon name={basename(c.path)} type={c.type} size={14} />
      <span className="vx-meta min-w-0 flex-1 truncate text-vx-text-2" title={c.fromPath ? `${c.fromPath} → ${c.path}` : c.path}>
        {c.fromPath ? (
          <>
            <span className="text-vx-text-3">{c.fromPath}</span>
            <span className="px-1.5 text-vx-text-4">→</span>
            {c.path}
          </>
        ) : (
          c.path
        )}
        {c.type === 'dir' ? <span className="text-vx-text-4">/</span> : null}
      </span>
      <span className="vx-meta shrink-0 text-right text-vx-text-3">{size}</span>
      <span className={cx('vx-micro w-16 shrink-0 text-right', linkable ? 'text-vx-text-3 group-hover:text-vx-text-1' : 'text-transparent')} aria-hidden>
        compare ›
      </span>
    </>
  );
  const cls = 'group flex h-8 items-center gap-3 border-b border-vx-hair-soft px-6 transition-colors duration-[120ms]';
  return linkable ? (
    <Link href={compareHref(c.path, a, b)} className={cx(cls, 'vx-inset-focus hover:bg-vx-surface-2')} aria-label={`Compare ${c.path}`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default DriveCompareList;
