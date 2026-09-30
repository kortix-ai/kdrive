'use client';

// Placeholder: the new-token dialog (built by its owner).
export function TokenDialog({ open }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <p className="vx-meta text-vx-text-3">New agent token — coming soon.</p>;
}

export default TokenDialog;
