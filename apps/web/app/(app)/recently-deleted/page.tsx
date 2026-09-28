'use client';

// STUB (FOUNDATION). Owner: WEB-versioning.
import { EmptyState } from '@/components/ui/empty-state';

export default function RecentlyDeletedPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-vx-hair px-6">
        <h1 className="vx-h1 text-[15px]">Recently deleted</h1>
      </header>
      <EmptyState className="flex-1" title="Recently deleted" body="Coming together (WEB-versioning)." />
    </div>
  );
}
