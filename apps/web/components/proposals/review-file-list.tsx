'use client';

// Placeholder: the file list of a proposal review (built by its owner).
import type { ProposalFile } from '@volumes/shared';

export function ReviewFileList(_props: {
  files: ProposalFile[];
  selected: number | null;
  onSelect: (seq: number) => void;
  checked: Set<number>;
  onCheck: (seq: number, on: boolean) => void;
}) {
  return <p className="vx-meta text-vx-text-3">Files — coming soon.</p>;
}

export default ReviewFileList;
