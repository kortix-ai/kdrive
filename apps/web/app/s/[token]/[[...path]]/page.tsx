'use client';

// STUB (FOUNDATION). Owner: WEB-preview-share-settings. Public share page (no sign-in).
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  return (
    <div className="flex h-dvh items-center justify-center">
      <EmptyState title="Shared with you" body={`Link ${token?.slice(0, 6) ?? ''}… (WEB-preview-share-settings)`} />
    </div>
  );
}
