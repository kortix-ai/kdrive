'use client';

// The strip over the drive while a tag filter is on: which tag, how many items carry it
// (across the whole drive, not just this folder), and the way back to the folder.
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { labelIndex, useAnnotationsUi, useLabels } from '@/lib/annotations';
import { LabelChip } from './label-chip';

export function TaggedBar({ labelId, count }: { labelId: string; count: number | null }) {
  const { data } = useLabels();
  const label = labelIndex(data)?.byId.get(labelId);
  return (
    <div className="mx-2 mb-1 flex h-9 shrink-0 items-center gap-2 rounded-vx-sm border border-vx-hair bg-vx-surface-2 pl-3 pr-1" role="status">
      <span className="text-[13px] leading-5 text-vx-text-2">Tagged</span>
      {label ? <LabelChip label={label} /> : null}
      <span className="vx-meta min-w-0 flex-1 truncate text-vx-text-3">
        {count === null ? 'Looking across the drive…' : `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'} across the drive`}
      </span>
      <Button size="xs" variant="ghost" icon={<X size={14} strokeWidth={1.75} aria-hidden />} onClick={() => useAnnotationsUi.getState().setFilter(null)}>
        Show folder
      </Button>
    </div>
  );
}
