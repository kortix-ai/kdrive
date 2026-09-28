'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. /compare/drive?a=&b= (drive compare).
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';

function CompareDrive() {
  const sp = useSearchParams();
  return <EmptyState title="Compare drive versions" body={`${sp.get('a') ?? '?'} → ${sp.get('b') ?? '?'} (WEB-versioning)`} />;
}

export default function CompareDrivePage() {
  return (
    <Suspense fallback={null}>
      <CompareDrive />
    </Suspense>
  );
}
