'use client';

// Over quota (DESIGN §6.12): shown before any byte is sent. A meter compares
// used + requested with the quota; the red tail is the part over.
import { formatBytes } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { closeQuota, useUploadPrompts } from '@/lib/upload/prompts';

export default function QuotaDialog() {
  const q = useUploadPrompts((s) => s.quota);
  if (!q) return null;
  const scale = Math.max(q.quotaBytes, q.usedBytes + q.requestedBytes, 1);
  const usedPct = (Math.min(q.usedBytes, q.quotaBytes) / scale) * 100;
  const fitPct = (Math.max(0, Math.min(q.requestedBytes, q.quotaBytes - q.usedBytes)) / scale) * 100;
  const overPct = (Math.max(0, q.overBytes) / scale) * 100;
  const quotaPct = (q.quotaBytes / scale) * 100;
  return (
    <Dialog
      open
      title="Not enough space"
      width={420}
      onClose={closeQuota}
      onSubmit={closeQuota}
      footer={
        <Button variant="primary" onClick={closeQuota}>
          Choose fewer files
        </Button>
      }
    >
      <p className="vx-body text-vx-text-1">This upload needs {formatBytes(q.overBytes)} more than you have.</p>
      <div className="relative mt-4 h-2 bg-vx-hair" aria-hidden>
        <span className="absolute inset-y-0 left-0 bg-[var(--pt-300)]" style={{ width: `${usedPct}%` }} />
        <span className="absolute inset-y-0 bg-vx-text-3" style={{ left: `${usedPct}%`, width: `${fitPct}%` }} />
        <span className="absolute inset-y-0 bg-vx-danger" style={{ left: `${usedPct + fitPct}%`, width: `${overPct}%` }} />
        <span className="absolute -top-1 -bottom-1 w-px bg-vx-text-1" style={{ left: `${quotaPct}%` }} />
      </div>
      <p className="vx-meta mt-3 text-vx-text-3">
        used {formatBytes(q.usedBytes)} <span className="vx-unit">·</span> requested {formatBytes(q.requestedBytes)} <span className="vx-unit">·</span> quota{' '}
        {formatBytes(q.quotaBytes)}
      </p>
      <p className="vx-body mt-4 text-vx-text-3">
        Nothing was sent. Pick fewer files, delete something you no longer need, or ask an admin for more space.
      </p>
    </Dialog>
  );
}
