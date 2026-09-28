'use client';

// STUB (FOUNDATION). Owner: WEB-preview-share-settings.
import { EmptyState } from '@/components/ui/empty-state';

export default function AdminPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-vx-hair px-6">
        <h1 className="vx-h1 text-[15px]">Admin</h1>
      </header>
      <EmptyState className="flex-1" title="Admin" body="Coming together (WEB-preview-share-settings)." />
    </div>
  );
}
