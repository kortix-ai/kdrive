'use client';

// The open-proposals count in the sidebar's Proposals item (UNIFY-SPEC §14.4): the nav count chip in its
// accent-wash attention variant with the number of proposals waiting in the current workspace, hidden at 0, "99+" above 99.
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
      className="vx-nav-count is-attention vx-side-full shrink-0"
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
