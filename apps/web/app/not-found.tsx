import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard, AuthFrame } from '@/components/auth/auth-frame';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { buttonClass } from '@/components/ui/button-class';
import { GlassFolder, HUES } from '@/components/ui/glass-folder';

export const metadata: Metadata = { title: 'Nothing here' };

// 404: the sign-in paper and grain, a ghost object where the page would be, and the way back to the drive.
export default function NotFound() {
  return (
    <AuthFrame
      objects={false}
      bar={
        <>
          <Brand href="/" size={22} />
          <ThemeToggle size="md" className="-mr-1.5" />
        </>
      }
    >
      <AuthCard className="max-w-[440px] px-[34px] pb-8 pt-9 text-center max-[720px]:px-5 max-[720px]:pb-6 max-[720px]:pt-7">
        <main className="flex flex-col items-center">
          <GlassFolder ghost hue={HUES.cobalt} size={150} tag="404" />
          <h1 className="mt-7 text-[32px] font-semibold leading-[38px] tracking-[-0.03em] text-vx-text-1 max-[720px]:text-[28px] max-[720px]:leading-[34px]">
            Nothing <em className="font-[family-name:var(--vx-font-display)] font-normal italic tracking-[-0.01em]">here.</em>
          </h1>
          <p className="mt-2 max-w-[320px] text-[16px] leading-6 text-vx-text-2">This page does not exist. Your files are safe in your drive.</p>
          <div className="mt-7 flex w-full flex-col gap-2.5">
            <Link href="/drive" className={buttonClass('primary', 'lg', { block: true })}>
              Go to My Drive
            </Link>
            <Link href="/" className={buttonClass('ghost', 'md', { block: true })}>
              KDRIVE home
            </Link>
          </div>
        </main>
      </AuthCard>
    </AuthFrame>
  );
}
