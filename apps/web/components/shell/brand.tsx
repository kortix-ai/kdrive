import Link from 'next/link';
import { cx } from '@/components/ui/cx';

/** The mark (DESIGN-v2 §4.1): three stacked rounded sheets; the back two in accent wash, the front in accent with a rule. */
export function Mark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cx('shrink-0', className)}>
      <rect x="8" y="3" width="16" height="12" rx="4" fill="var(--vx-accent-wash)" />
      <rect x="5" y="8" width="22" height="13" rx="4" fill="var(--vx-accent-wash-2)" />
      <rect x="2" y="14" width="28" height="15" rx="4" fill="var(--vx-accent)" />
      <circle cx="8.5" cy="21.5" r="2" fill="var(--vx-on-accent)" />
      <path d="M13 21.5h10" stroke="var(--vx-on-accent)" strokeWidth="2" strokeLinecap="round" opacity=".75" />
    </svg>
  );
}

/** Mark + "Volumes" wordmark (20/600, −0.02em). Links to the drive unless `href` is null. */
export function Brand({ href = '/drive', size = 32, className, compactBelow }: { href?: string | null; size?: number; className?: string; compactBelow?: boolean }) {
  const inner = (
    <>
      <Mark size={size} />
      <span className={cx('text-[20px] font-semibold leading-7 tracking-[-0.02em] text-vx-text-1', compactBelow && 'vx-side-full')}>Volumes</span>
    </>
  );
  const cls = cx('inline-flex items-center gap-2.5 rounded-vx-sm', className);
  return href ? (
    <Link href={href} className={cls} aria-label="Volumes, go to My Drive">
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export default Brand;
