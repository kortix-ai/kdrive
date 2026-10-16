'use client';

// Over quota (UNIFY-SPEC §14.2, DESIGN-v2 §6.13, 420 px): shown before any byte is sent. A 6 px
// r2 meter: used (accent) + requested (danger, 45° stripes) against the quota mark; Mono meta.
// Under it, the next plan that would hold the upload, with the price an admin set.
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatBytes, formatPlanPrice, isPaidPlan, withPrices, type Plan, type PlanPrices } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useConfig } from '@/lib/api/hooks';
import { closeQuota, useUploadPrompts } from '@/lib/upload/prompts';

/** The smallest paid plan bigger than the quota (one that holds `neededBytes` when there is one), with its price. */
export function nextPlan(quotaBytes: number, neededBytes: number, prices?: Partial<PlanPrices> | null): Plan | null {
  const bigger = withPrices(prices).filter((p) => isPaidPlan(p.id) && p.storageBytes > quotaBytes);
  return bigger.find((p) => p.storageBytes >= neededBytes) ?? bigger[bigger.length - 1] ?? null;
}

export default function QuotaDialog() {
  const q = useUploadPrompts((s) => s.quota);
  const { data: config } = useConfig();
  if (!q) return null;
  const next = nextPlan(q.quotaBytes, q.usedBytes + q.requestedBytes, config?.billing.prices);
  const nextPrice = next ? formatPlanPrice(next) : null;
  const scale = Math.max(q.quotaBytes, q.usedBytes + q.requestedBytes, 1);
  const usedPct = (Math.min(q.usedBytes, scale) / scale) * 100;
  const reqPct = (Math.max(0, q.requestedBytes) / scale) * 100;
  const quotaPct = (q.quotaBytes / scale) * 100;
  return (
    <Dialog
      open
      title="Not enough space"
      description={`This upload needs ${formatBytes(q.overBytes)} more than you have.`}
      width={420}
      onClose={closeQuota}
      onSubmit={closeQuota}
      footer={
        <Button variant="primary" onClick={closeQuota}>
          Choose fewer files
        </Button>
      }
    >
      <div className="relative mt-1 h-1.5 overflow-hidden rounded-vx-xs bg-vx-meter-track" aria-hidden>
        <span className="absolute inset-y-0 left-0 bg-vx-accent" style={{ width: `${usedPct}%` }} />
        <span
          className="absolute inset-y-0"
          style={{
            left: `${usedPct}%`,
            width: `${Math.min(reqPct, 100 - usedPct)}%`,
            backgroundImage: 'repeating-linear-gradient(45deg, var(--vx-danger) 0 4px, var(--vx-danger-wash) 4px 7px)',
          }}
        />
        {quotaPct < 100 ? <span className="absolute inset-y-0 w-0.5 bg-vx-text-2" style={{ left: `${quotaPct}%` }} /> : null}
      </div>
      <p className="vx-meta mt-2 text-vx-text-3">
        used {formatBytes(q.usedBytes)} · requested {formatBytes(q.requestedBytes)} · quota {formatBytes(q.quotaBytes)}
      </p>
      <p className="vx-body mt-4 text-vx-text-2">Nothing was sent. Pick fewer files, delete something you no longer need, or ask an admin for more space.</p>
      {next ? (
        <p className="vx-body mt-3 text-vx-text-2">
          {next.name} holds {formatBytes(next.storageBytes)}
          {nextPrice ? ` for ${nextPrice}` : ''}.{' '}
          <Link
            href="/pricing"
            onClick={closeQuota}
            className="inline-flex items-center gap-1 text-vx-text-1 underline underline-offset-4 hover:text-vx-text-1"
          >
            See plans
            <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
          </Link>
        </p>
      ) : null}
    </Dialog>
  );
}
