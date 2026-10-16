'use client';

// The Comments part of the preview panel: threads on the file (a first comment and its
// replies), newest activity last, resolved ones folded away; a box to write a new one.
// Every member of the drive comments, viewers too. Each comment names the version it was
// written on, which opens that version's preview.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MoreHorizontal, Pencil, Reply, RotateCcw, Trash } from 'lucide-react';
import type { FileComment } from '@volumes/shared';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api/endpoints';
import { revalidateAnnotations, useAnnotationsUi, useComments } from '@/lib/annotations';
import { formatDate, formatRelative, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { CommentBody, Composer, type ComposerHandle } from './comment-text';

type Thread = { root: FileComment; replies: FileComment[] };

/** Threads in order of their first comment; replies oldest first. */
export function threadsOf(comments: FileComment[]): Thread[] {
  const roots = new Map<string, Thread>();
  for (const c of comments) if (!c.parentId) roots.set(c.id, { root: c, replies: [] });
  for (const c of comments) if (c.parentId) roots.get(c.parentId)?.replies.push(c);
  return [...roots.values()];
}

const nameOf = (a: FileComment['author']) => a.name || a.email || 'Former member';

interface Ops {
  ws: string;
  path: string;
  /** The version the preview shows (null = now). */
  at: string | null;
  past: boolean;
  onDelete: (c: FileComment) => void;
}

function CommentItem({ c, ops, onReply, extra }: { c: FileComment; ops: Ops; onReply?: () => void; extra?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const items: MenuItem[] = [
    ...(c.canEdit ? [{ id: 'edit', label: 'Edit', icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => setEditing(true) }] : []),
    ...(c.canDelete ? [{ id: 'del', label: 'Delete', icon: <Trash size={16} strokeWidth={1.75} />, danger: true, onSelect: () => ops.onDelete(c) }] : []),
  ];
  const onThisVersion = !!c.commitId && ops.at === c.commitId;
  return (
    <div className="group/c flex gap-2.5">
      <Avatar name={nameOf(c.author)} image={c.author.image} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] font-semibold leading-5 text-vx-text-1" title={c.author.email ?? undefined}>
            {nameOf(c.author)}
          </span>
          <span className="vx-meta shrink-0 text-vx-text-3" title={isoTitle(c.createdAt)}>
            {formatRelative(c.createdAt)}
          </span>
          {c.editedAt ? (
            <span className="vx-meta shrink-0 text-vx-text-4" title={`Edited ${formatDate(c.editedAt)}`}>
              · edited
            </span>
          ) : null}
          <span className="flex-1" />
          {extra}
          {items.length && !editing ? (
            <Menu
              align="end"
              minWidth={160}
              items={items}
              trigger={(p) => (
                <IconButton {...p} size="xs" label="Comment actions" className="opacity-0 focus-visible:opacity-100 group-hover/c:opacity-100 aria-expanded:opacity-100">
                  <MoreHorizontal size={14} strokeWidth={1.75} aria-hidden />
                </IconButton>
              )}
            />
          ) : null}
        </div>
        {editing ? (
          <div className="pt-1">
            <Composer
              placeholder="Edit comment"
              submitLabel="Save"
              initial={c.body}
              autoFocus
              compact
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                await api.comments.update(ops.ws, c.id, { body });
                await revalidateAnnotations();
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <CommentBody text={c.body} />
        )}
        <div className="mt-0.5 flex min-h-6 flex-wrap items-center gap-x-2">
          {c.commitAt ? (
            onThisVersion ? (
              <span className="vx-meta text-vx-text-4">on this version</span>
            ) : (
              <button
                type="button"
                className="vx-meta rounded-vx-xs text-vx-text-4 underline-offset-[3px] hover:text-vx-text-2 hover:underline"
                title={`See the file as it was when this was written (${c.commitId})`}
                onClick={() => useVx.getState().openPreview(ops.path, { at: c.commitId })}
              >
                on version of {formatDate(c.commitAt)}
              </button>
            )
          ) : null}
          {onReply && !ops.past ? (
            <button type="button" onClick={onReply} className="vx-meta inline-flex items-center gap-1 rounded-vx-xs text-vx-text-3 hover:text-vx-text-1">
              <Reply size={12} strokeWidth={2} aria-hidden /> Reply
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ThreadView({ t, ops }: { t: Thread; ops: Ops }) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const resolved = !!t.root.resolvedAt;
  const setResolved = async (on: boolean) => {
    setBusy(true);
    try {
      await api.comments.update(ops.ws, t.root.id, { resolved: on });
      await revalidateAnnotations();
    } catch (e) {
      useVx.getState().toast({ kind: 'error', message: e instanceof Error ? e.message : 'Could not change the thread.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={cx('rounded-vx-sm border border-vx-hair px-3 pb-2 pt-2', resolved ? 'bg-transparent' : 'bg-vx-surface-2')}>
      <div className={cx('flex flex-col gap-2.5', resolved && 'opacity-80')}>
        <CommentItem
          c={t.root}
          ops={ops}
          onReply={() => setReplying(true)}
          extra={
            ops.past ? null : (
              <Tooltip label={resolved ? 'Reopen thread' : 'Resolve thread'}>
                <IconButton size="xs" label={resolved ? 'Reopen thread' : 'Resolve thread'} nativeTitle={false} disabled={busy} onClick={() => void setResolved(!resolved)}>
                  {resolved ? <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> : <Check size={14} strokeWidth={2} aria-hidden />}
                </IconButton>
              </Tooltip>
            )
          }
        />
        {t.replies.map((r) => (
          <div key={r.id} className="border-l border-vx-hair pl-3">
            <CommentItem c={r} ops={ops} onReply={() => setReplying(true)} />
          </div>
        ))}
      </div>
      {replying ? (
        <div className="mt-2 border-l border-vx-hair pl-3">
          <Composer
            placeholder="Reply"
            submitLabel="Reply"
            autoFocus
            compact
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              await api.comments.create(ops.ws, { path: ops.path, body, parentId: t.root.id });
              await revalidateAnnotations();
              setReplying(false);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

/** The Comments disclosure of a file's preview. Open state is shared (useAnnotationsUi). */
export default function CommentsSection({ ws, path, at }: { ws: string; path: string; at: string | null }) {
  const open = useAnnotationsUi((s) => s.commentsOpen);
  const tick = useAnnotationsUi((s) => s.composeTick);
  const setOpen = useAnnotationsUi((s) => s.setCommentsOpen);
  const { data, error } = useComments(open ? path : null);
  const [showResolved, setShowResolved] = useState(false);
  const [deleting, setDeleting] = useState<FileComment | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const section = useRef<HTMLDivElement>(null);
  const past = !!at;

  // Opened from a menu ("Comments"): bring the box into view and focus it.
  useEffect(() => {
    if (!tick || !open) return;
    const id = requestAnimationFrame(() => {
      section.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      composer.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [tick, open, path]);

  const threads = useMemo(() => threadsOf(data?.comments ?? []), [data]);
  const openThreads = threads.filter((t) => !t.root.resolvedAt);
  const doneThreads = threads.filter((t) => t.root.resolvedAt);
  const count = data?.comments.length;
  const ops: Ops = { ws, path, at, past, onDelete: setDeleting };

  return (
    <div ref={section} className="border-t border-vx-hair">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="vx-inset-focus flex h-10 w-full items-center gap-2 px-4 text-left transition-colors duration-[120ms] hover:bg-vx-raise"
      >
        <span className="vx-eyebrow">Comments</span>
        {count ? <span className="vx-meta tabular-nums text-vx-text-3">{count}</span> : null}
        <ChevronDown size={14} strokeWidth={1.75} className={cx('text-vx-text-3 transition-transform duration-[120ms]', open ? '' : '-rotate-90')} aria-hidden />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-3 pb-4">
          {error ? (
            <p className="px-1 text-[13px] leading-5 text-vx-danger">Couldn't load the comments.</p>
          ) : !data ? (
            <span className="skeleton skel-line mx-1 inline-block w-40" />
          ) : threads.length === 0 ? (
            <p className="px-1 text-[13px] leading-5 text-vx-text-3">No comments yet. Everyone with access to this drive can read and add them.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Comment threads">
              {openThreads.map((t) => (
                <ThreadView key={t.root.id} t={t} ops={ops} />
              ))}
            </ul>
          )}
          {doneThreads.length ? (
            <div className="flex flex-col gap-2">
              <button type="button" aria-expanded={showResolved} onClick={() => setShowResolved((v) => !v)} className="vx-meta flex items-center gap-1 self-start rounded-vx-xs px-1 text-vx-text-3 hover:text-vx-text-1">
                <ChevronDown size={12} strokeWidth={2} className={cx('transition-transform duration-[120ms]', showResolved ? '' : '-rotate-90')} aria-hidden />
                {doneThreads.length} resolved
              </button>
              {showResolved ? (
                <ul className="flex flex-col gap-2" aria-label="Resolved threads">
                  {doneThreads.map((t) => (
                    <ThreadView key={t.root.id} t={t} ops={ops} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {past ? (
            <p className="vx-meta px-1 text-vx-text-3">Comments belong to the file as it is now. Go back to now to add one.</p>
          ) : (
            <Composer
              ref={composer}
              placeholder="Add a comment"
              submitLabel="Comment"
              onSubmit={async (body) => {
                await api.comments.create(ws, { path, body });
                await revalidateAnnotations();
              }}
            />
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        title={deleting && !deleting.parentId && threads.find((t) => t.root.id === deleting.id)?.replies.length ? 'Delete this thread?' : 'Delete this comment?'}
        body={deleting && !deleting.parentId ? 'Its replies go with it. This cannot be undone.' : 'This cannot be undone.'}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.comments.remove(ws, deleting.id);
          await revalidateAnnotations();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
