import { formatBytes, type FileSide } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { formatDate } from '@/lib/format';
import { CommitId } from './readout';

type Fact = { label: string; a: React.ReactNode; b: React.ReactNode; same: boolean };

const mimeLabel = (m: string) => m.split(';')[0];

/** Binary / other (or too large to diff): two-column facts table + verdict + both downloads. */
export function CompareMeta({ a, b, note }: { a: FileSide | null; b: FileSide | null; note?: string }) {
  const facts: Fact[] = [
    { label: 'Size', a: a ? formatBytes(a.size) : '—', b: b ? formatBytes(b.size) : '—', same: !!a && !!b && a.size === b.size },
    { label: 'Type', a: a ? mimeLabel(a.mime) : '—', b: b ? mimeLabel(b.mime) : '—', same: !!a && !!b && mimeLabel(a.mime) === mimeLabel(b.mime) },
    {
      label: 'Content hash',
      a: a?.version ? a.version.toLowerCase() : '—',
      b: b?.version ? b.version.toLowerCase() : '—',
      same: !!a?.version && a.version === b?.version,
    },
    {
      label: 'Modified',
      a: a ? formatDate(a.mtime || a.createdAt) : '—',
      b: b ? formatDate(b.mtime || b.createdAt) : '—',
      same: !!a && !!b && a.mtime === b.mtime,
    },
    { label: 'Version', a: a ? <CommitId id={a.commitId} /> : '—', b: b ? <CommitId id={b.commitId} /> : '—', same: !!a && !!b && a.commitId === b.commitId },
  ];
  const identical = !!a && !!b && ((!!a.version && a.version === b.version) || a.commitId === b.commitId);
  const verdict = !a || !b ? (a ? 'Only A has this file' : b ? 'Only B has this file' : 'Neither version has this file') : identical ? 'Identical content' : 'These versions differ';

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <div className="vx-title">{verdict}</div>
      {note ? <p className="vx-body mt-1 text-vx-text-3">{note}</p> : null}
      <div className="mt-5 border border-vx-hair">
        <div className="grid grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)] border-b border-vx-hair bg-vx-surface-2">
          <span className="vx-label px-3 py-2" />
          <span className="vx-label px-3 py-2">A</span>
          <span className="vx-label px-3 py-2">B</span>
        </div>
        {facts.map((f) => (
          <div key={f.label} className="grid grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)] border-b border-vx-hair-soft last:border-b-0">
            <span className="vx-label px-3 py-2.5">{f.label}</span>
            <span className={cx('vx-meta truncate px-3 py-2.5', f.same ? 'text-vx-text-4' : 'text-vx-text-1')}>{f.a}</span>
            <span className={cx('vx-meta truncate px-3 py-2.5', f.same ? 'text-vx-text-4' : 'text-vx-text-1')}>{f.b}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        {a ? (
          <a href={a.downloadUrl} download className="inline-flex h-8 items-center border border-vx-hair px-3 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1">
            ↓ Download A
          </a>
        ) : null}
        {b ? (
          <a href={b.downloadUrl} download className="inline-flex h-8 items-center border border-vx-hair px-3 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1">
            ↓ Download B
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default CompareMeta;
