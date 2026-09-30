'use client';

// Placeholder: the compare pane of a proposal review (built by its owner).
import type { ProposalFile } from '@volumes/shared';

export function ReviewPane(_props: { file: ProposalFile | null; onAccept?: (seq: number) => void; onDiscard?: (seq: number) => void }) {
  return <p className="vx-meta text-vx-text-3">Review — coming soon.</p>;
}

export default ReviewPane;
