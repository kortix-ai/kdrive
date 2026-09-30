'use client';

// Placeholder: one row of the proposals inbox (built by its owner).
import type { ProposalSummary } from '@volumes/shared';

export function ProposalRow({ proposal }: { proposal: ProposalSummary }) {
  return <p className="vx-meta text-vx-text-3">{proposal.message || 'Proposal'}</p>;
}

export default ProposalRow;
