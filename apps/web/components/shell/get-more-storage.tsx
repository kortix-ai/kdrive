'use client';

// The sidebar's way to more space: under the storage meter, in every storage mode. A quiet
// outline button while there is room; once the meter turns amber or red it becomes the
// primary action, in the meter's colour, because the next upload may not fit.
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { meterLevel } from '@volumes/shared';
import { buttonClass } from '@/components/ui/button-class';
import { cx } from '@/components/ui/cx';
import { useUsage } from '@/lib/api/hooks';

export const PRICING_HREF = '/pricing';

export function GetMoreStorage({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { data } = useUsage();
  const level = data ? meterLevel(data.usedBytes, data.quotaBytes) : 'ok';
  return (
    <Link
      href={PRICING_HREF}
      onClick={onNavigate}
      data-level={level}
      className={buttonClass(level === 'ok' ? 'outline' : 'primary', 'sm', {
        block: true,
        className: cx(
          'justify-between',
          level === 'amber' && '!bg-vx-warn !text-vx-bg hover:!brightness-110',
          level === 'red' && '!bg-vx-danger-fill !text-vx-on-danger hover:!brightness-110',
          className,
        ),
      })}
    >
      Get more storage
      <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

export default GetMoreStorage;
