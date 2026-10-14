import Link from 'next/link';
import { KMark } from '@/components/brand/k-mark';
import { cx } from '@/components/ui/cx';

/**
 * The KDRIVE lockup (UNIFY-SPEC §8.2): the K mark + "KDRIVE" in Inter 600, 15px, tracking .08em, text-1
 * (identical to the landing nav). Links to the drive unless `href` is null. `compactBelow` hides the word in the
 * collapsed sidebar range (720–1023), where the mark alone shows at 20px.
 */
export function Brand({
  href = '/drive',
  size = 16,
  className,
  compactBelow,
}: {
  href?: string | null;
  size?: number;
  className?: string;
  compactBelow?: boolean;
}) {
  const inner = (
    <>
      {compactBelow ? (
        <>
          <KMark size={size} className="shrink-0 vx-side-full" />
          <KMark size={20} className="shrink-0 vx-side-compact" />
        </>
      ) : (
        <KMark size={size} className="shrink-0" />
      )}
      <span className={cx('vx-wordmark', compactBelow && 'vx-side-full')}>KDRIVE</span>
    </>
  );
  const cls = cx('inline-flex items-center gap-2 rounded-vx-sm', className);
  return href ? (
    <Link href={href} className={cls} aria-label="KDRIVE, go to My Drive">
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

/** The large metal lockup (sign-in): metal cube 28 + "KDRIVE" Inter 700, 28px, in the metal gradient. */
export function BrandMetal({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-3', className)}>
      <KMark size={28} className="shrink-0" />
      <span className="vx-metal text-[28px] font-bold leading-8 tracking-[-0.02em]">KDRIVE</span>
    </span>
  );
}

export default Brand;
