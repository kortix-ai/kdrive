'use client';

// The open-proposals count in the sidebar's Proposals item (MCP.md §14.6): an accent-wash
// pill with the number of proposals waiting in the current workspace, hidden at 0, "99+" above 99.
import { useProposalCount } from '@/lib/api/hooks';

export function navCountLabel(n: number | null | undefined): string | null {
  if (!n || n <= 0 || !Number.isFinite(n)) return null;
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** The pill alone (tested without SWR). */
export function NavCountPill({ n }: { n: number | null | undefined }) {
  const label = navCountLabel(n);
  if (!label) return null;
  return (
    <span
      data-nav-count=""
      className="vx-nav-count vx-side-full inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full !bg-vx-accent-wash px-1.5 text-[11px] font-semibold leading-4 tabular-nums !text-vx-on-accent-wash"
    >
      {label}
      <span className="sr-only"> waiting for review</span>
    </span>
  );
}

export function ProposalsNavCount() {
  const { data } = useProposalCount();
  return <NavCountPill n={data?.open} />;
}

export default ProposalsNavCount;
