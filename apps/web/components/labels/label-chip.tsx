'use client';

// Tag chips (the API calls them labels): a muted ink from the --vx-label-* palette on a
// wash of itself (.vx-tag in globals.css). Rows and tiles show small chips (or dots when
// tight); the preview header shows them at full size.
import { MessageSquare } from 'lucide-react';
import { LABEL_COLORS, type FileLabel, type LabelColor } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { Tooltip } from '@/components/ui/tooltip';
import { commentCountOf, labelIndex, useCommentCounts, useLabels } from '@/lib/annotations';

/** Display names of the palette, in palette order. */
export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  slate: 'Slate',
  sage: 'Sage',
  moss: 'Moss',
  sand: 'Sand',
  clay: 'Clay',
  rose: 'Rose',
  plum: 'Plum',
  sky: 'Sky',
};

export const inkOf = (color: LabelColor) => ({ '--lc': `var(--vx-label-${color})` }) as React.CSSProperties;

/** The palette colour a new tag gets: the first one the drive uses least. */
export function nextLabelColor(labels: Pick<FileLabel, 'color'>[]): LabelColor {
  const used = new Map<LabelColor, number>(LABEL_COLORS.map((c) => [c, 0]));
  for (const l of labels) used.set(l.color, (used.get(l.color) ?? 0) + 1);
  return [...LABEL_COLORS].sort((a, b) => used.get(a)! - used.get(b)!)[0];
}

export function LabelDot({ color, className }: { color: LabelColor; className?: string }) {
  return <span aria-hidden className={cx('vx-tag-dot inline-block h-2 w-2 shrink-0 rounded-full', className)} style={inkOf(color)} />;
}

export function LabelChip({ label, size = 'sm', className }: { label: Pick<FileLabel, 'name' | 'color'>; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      style={inkOf(label.color)}
      className={cx(
        'vx-tag inline-flex max-w-[160px] shrink-0 items-center gap-1 whitespace-nowrap rounded-vx-xs font-medium',
        size === 'md' ? 'h-6 px-2 text-[12px] leading-4' : 'h-5 px-1.5 text-[11px] leading-4',
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** A comment count: a speech bubble and the number (open threads in the tooltip). */
export function CommentCountBadge({ count, open, lit, className }: { count: number; open: number; lit?: boolean; className?: string }) {
  const tip = `${count} ${count === 1 ? 'comment' : 'comments'}${open ? ` · ${open} open` : ''}`;
  return (
    <Tooltip label={tip}>
      <span
        aria-label={tip}
        className={cx(
          'vx-meta inline-flex h-5 shrink-0 items-center gap-1 rounded-vx-xs px-1 tabular-nums',
          lit ? 'text-vx-on-selection' : open ? 'text-vx-text-2' : 'text-vx-text-3',
          className,
        )}
      >
        <MessageSquare size={12} strokeWidth={2} aria-hidden />
        {count}
      </span>
    </Tooltip>
  );
}

/**
 * The tags and comment count of one drive item, for rows and tiles. `max` chips are
 * shown by name; the rest fold into "+N" (dots only when `dots`).
 */
export function ItemAnnotations({ path, lit, max = 2, dots, className }: { path: string; lit?: boolean; max?: number; dots?: boolean; className?: string }) {
  const { data: labels } = useLabels();
  const { data: counts } = useCommentCounts();
  const tags = labelIndex(labels)?.byPath.get(path) ?? [];
  const c = commentCountOf(counts, path);
  if (!tags.length && !c) return null;
  const shown = dots ? [] : tags.slice(0, max);
  const rest = dots ? tags : tags.slice(max);
  return (
    <span className={cx('flex min-w-0 shrink items-center gap-1', className)} data-no-marquee>
      {shown.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {rest.length ? (
        <Tooltip label={rest.map((l) => l.name).join(', ')}>
          <span className="inline-flex h-5 shrink-0 items-center gap-0.5 px-0.5" aria-label={`Tags: ${rest.map((l) => l.name).join(', ')}`}>
            {rest.slice(0, 4).map((l) => (
              <LabelDot key={l.id} color={l.color} />
            ))}
            {!dots && rest.length ? <span className={cx('vx-meta pl-0.5', lit ? 'text-vx-on-selection' : 'text-vx-text-3')}>+{rest.length}</span> : null}
          </span>
        </Tooltip>
      ) : null}
      {c ? <CommentCountBadge count={c.count} open={c.open} lit={lit} /> : null}
    </span>
  );
}
