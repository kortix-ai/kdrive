import Link from 'next/link';
import { buttonClass } from '@/components/ui/button-class';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFound() {
  return (
    <div className="flex h-dvh items-center justify-center bg-vx-bg p-4">
      <div className="vx-sheet w-full max-w-[480px]">
        <EmptyState
          tone="past"
          title="Nothing here"
          body="This page does not exist. Your files are safe in your drive."
          actions={
            <Link href="/drive" className={buttonClass('primary')}>
              Go to My Drive
            </Link>
          }
        />
      </div>
    </div>
  );
}
