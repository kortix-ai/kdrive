'use client';

// /proposals/[id] — review one proposal (MCP.md §14.7).
import { useParams } from 'next/navigation';
import { ProposalReview } from '@/components/proposals/proposal-review';

export default function ProposalReviewPage() {
  const params = useParams<{ id?: string | string[] }>();
  const raw = params?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) return null;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // keep the raw segment
  }
  return <ProposalReview key={decoded} id={decoded} />;
}
