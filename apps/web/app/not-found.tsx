import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFound() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <EmptyState
        title="Nothing here"
        body="This page does not exist. Your files are safe in your drive."
        actions={
          <Link href="/drive" className="inline-flex h-8 items-center border border-vx-hair px-3 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1">
            Go to My Drive
          </Link>
        }
      />
    </div>
  );
}
