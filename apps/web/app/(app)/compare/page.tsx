'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. /compare?path=&a=&b= (file compare).
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';

function CompareFile() {
  const sp = useSearchParams();
  return <EmptyState title="Compare versions" body={`${sp.get('path') ?? ''} · ${sp.get('a') ?? '?'} → ${sp.get('b') ?? '?'} (WEB-versioning)`} />;
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareFile />
    </Suspense>
  );
}
