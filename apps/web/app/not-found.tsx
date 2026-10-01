import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { buttonClass } from '@/components/ui/button-class';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Nothing here' };

// 404 (UNIFY-SPEC §14.1): the atmosphere ground, no sheet; the same 56 px bar as the public share page.
export default function NotFound() {
  return (
    <AuthFrame
      bar={
        <>
          <Brand />
          <ThemeToggle size="sm" />
        </>
      }
    >
      <EmptyState
        art="gone"
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
