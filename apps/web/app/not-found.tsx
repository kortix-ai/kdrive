import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { Brand } from '@/components/shell/brand';
import { buttonClass } from '@/components/ui/button-class';
import { EmptyState } from '@/components/ui/empty-state';

// 404 (UNIFY-SPEC §14.1): the atmosphere ground, no sheet; the flat lockup top-left.
export default function NotFound() {
  return (
    <AuthFrame corner={<Brand />}>
      <EmptyState
        art="gone"
        tone="past"
        className="my-auto"
        title={<span className="vx-h1">Nothing here</span>}
        body="This page does not exist. Your files are safe in your drive."
        actions={
          <Link href="/drive" className={buttonClass('primary')}>
            Go to My Drive
          </Link>
        }
      />
    </AuthFrame>
  );
}
