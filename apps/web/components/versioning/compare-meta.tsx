import { Download } from 'lucide-react';
import { formatBytes, type FileSide } from '@volumes/shared';
import { buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { formatDate } from '@/lib/format';
import { SideDisc } from './compare-header';
import { CommitId } from './readout';

type Fact = { label: string; a: React.ReactNode; b: React.ReactNode; same: boolean; mono?: boolean };

const mimeLabel = (m: string) => m.split(';')[0];

/** Binary / other (or too large to diff): a two-column facts table, a verdict and both downloads. */
export function CompareMeta({ a, b, note }: { a: FileSide | null; b: FileSide | null; note?: string }) {
  const sizeSame = !!a && !!b && a.size === b.size;
  const hashSame = !!a?.version && a.version === b?.version;
  const facts: Fact[] = [
    { label: 'Size', a: a ? formatBytes(a.size) : '—', b: b ? formatBytes(b.size) : '—', same: sizeSame },
    { label: 'Type', a: a ? mimeLabel(a.mime) : '—', b: b ? mimeLabel(b.mime) : '—', same: !!a && !!b && mimeLabel(a.mime) === mimeLabel(b.mime) },
    {
      label: 'Modified',
      a: a ? formatDate(a.mtime || a.createdAt) : '—',
      b: b ? formatDate(b.mtime || b.createdAt) : '—',
      same: !!a && !!b && a.mtime === b.mtime,
    },
    {
      label: 'Hash',
      a: a?.version ? a.version.toLowerCase() : '—',
      b: b?.version ? b.version.toLowerCase() : '—',
      same: hashSame,
      mono: true,
    },
    { label: 'Version', a: a ? <CommitId id={a.commitId} /> : '—', b: b ? <CommitId id={b.commitId} /> : '—', same: !!a && !!b && a.commitId === b.commitId },
  ];
  const identical = !!a && !!b && (hashSame || a.commitId === b.commitId);
  const verdict =
    !a || !b
      ? a
        ? 'Only A has this file.'
        : b
          ? 'Only B has this file.'
          : 'Neither version has this file.'
      : identical
        ? 'These files are identical.'
        : !sizeSame
          ? 'These files differ in size and content.'
          : 'These files differ in content.';

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8 max-[720px]:px-4">
      <p className="text-[16px] font-semibold leading-6 text-vx-text-1">{verdict}</p>
      {note ? <p className="vx-body mt-1 text-vx-text-3">{note}</p> : null}
      <div className="mt-5 overflow-hidden rounded-vx-md border border-vx-hair">
        <div className="grid grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] bg-vx-surface-2 text-[13px] font-medium leading-5 text-vx-text-3 max-[720px]:grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)]">
          <span className="px-3 py-2" />
          <span className="flex items-center gap-2 px-3 py-2">
            <SideDisc which="A" /> A
          </span>
          <span className="flex items-center gap-2 px-3 py-2">
            <SideDisc which="B" /> B
          </span>
        </div>
        {facts.map((f) => (
          <div
            key={f.label}
            className="grid grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] border-t border-vx-hair-soft text-[13px] leading-5 max-[720px]:grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <span className="px-3 py-2.5 text-vx-text-3">{f.label}</span>
            {[f.a, f.b].map((v, i) => (
              <span
                key={i}
                title={typeof v === 'string' ? v : undefined}
                className={cx(
                  'truncate px-3 py-2.5 tabular-nums',
                  f.mono && 'font-mono text-[12px]',
                  f.same ? 'text-vx-text-4' : 'bg-vx-mod-bg font-semibold text-vx-text-1',
                )}
              >
                {v}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {a ? (
          <a href={a.downloadUrl} download className={buttonClass('outline', 'sm', { withIcon: true })}>
            <Download size={16} strokeWidth={1.75} aria-hidden /> Download A
          </a>
        ) : null}
        {b ? (
          <a href={b.downloadUrl} download className={buttonClass('outline', 'sm', { withIcon: true })}>
            <Download size={16} strokeWidth={1.75} aria-hidden /> Download B
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default CompareMeta;
