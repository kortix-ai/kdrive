'use client';

// STUB (FOUNDATION). Owner: WEB-drive. The file browser lives here (architecture §9.4).
import { useEffect } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { useDrivePath } from '@/lib/nav';
import { useVx } from '@/lib/store';

export default function DrivePage() {
  const path = useDrivePath();
  const setPath = useVx((s) => s.setPath);
  useEffect(() => setPath(path), [path, setPath]);
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-vx-hair px-4 font-mono text-[12px] text-vx-text-2">
        {path === '/' ? 'My Drive' : `My Drive${path}`}
      </header>
      <EmptyState className="flex-1" title="Drop files here, or press U" body="The file browser is being built (WEB-drive)." />
    </div>
  );
}
