'use client';

// The preview header's tags (a row of chips, with a button to change them) and its
// Comments button (opens the Comments section and puts the cursor in its box).
import { MessageSquare, Plus, Tag } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { commentCountOf, labelIndex, openComments, useAnnotationsUi, useCommentCounts, useLabels } from '@/lib/annotations';
import { currentRole, useVx } from '@/lib/store';
import { LabelChip } from './label-chip';

export function PreviewLabels({ path, past }: { path: string; past: boolean }) {
  const { data } = useLabels();
  const canEdit = useVx((s) => currentRole(s) !== 'viewer') && !past;
  const tags = labelIndex(data)?.byPath.get(path) ?? [];
  if (!tags.length || path === '/') return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Tags">
      {tags.map((l) => (
        <LabelChip key={l.id} label={l} size="md" />
      ))}
      {canEdit ? (
        <Tooltip label="Change tags">
          <IconButton
            size="xs"
            label="Change tags"
            nativeTitle={false}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              useAnnotationsUi.getState().openPicker({ x: r.left, y: r.bottom + 4, flipY: r.top - 4, paths: [path] });
            }}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Opens (or closes) the Comments section; shows the count when there are any. */
export function PreviewCommentsButton({ path }: { path: string }) {
  const { data } = useCommentCounts();
  const open = useAnnotationsUi((s) => s.commentsOpen);
  const c = commentCountOf(data, path);
  const label = c ? `Comments (${c.count})` : 'Comments';
  return (
    <Tooltip label={label}>
      <IconButton
        label={label}
        nativeTitle={false}
        size="sm"
        toggled={open}
        className="relative"
        onClick={() => (open ? useAnnotationsUi.getState().setCommentsOpen(false) : openComments(path))}
      >
        <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
        {c ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-vx-surface-3 px-[3px] font-mono text-[11px] font-semibold leading-none text-vx-text-1">
            {c.count > 99 ? '99+' : c.count}
          </span>
        ) : null}
      </IconButton>
    </Tooltip>
  );
}

/** The Tags icon for the preview tools when the item has no tags yet. */
export function PreviewTagButton({ path }: { path: string }) {
  const { data } = useLabels();
  const canEdit = useVx((s) => currentRole(s) !== 'viewer');
  if (!canEdit || (labelIndex(data)?.byPath.get(path)?.length ?? 0) > 0) return null;
  return (
    <Tooltip label="Tags">
      <IconButton
        label="Tags"
        nativeTitle={false}
        size="sm"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          useAnnotationsUi.getState().openPicker({ x: r.left, y: r.bottom + 4, flipY: r.top - 4, paths: [path] });
        }}
      >
        <Tag size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
