'use client';

// Manage tags: every tag of the drive with how many items carry it. The owner and editors
// add, rename, recolour and delete them; viewers see the list.
import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash } from 'lucide-react';
import { LABEL_COLORS, MAX_LABEL_NAME_CHARS, type FileLabel, type LabelColor } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { revalidateAnnotations, useAnnotationsUi, useLabels } from '@/lib/annotations';
import { currentRole, useVx } from '@/lib/store';
import { LABEL_COLOR_NAMES, LabelChip, LabelDot, inkOf, nextLabelColor } from './label-chip';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

/** The palette as a row of swatches (a radio group). */
export function ColorSwatches({ value, onChange, disabled }: { value: LabelColor; onChange: (c: LabelColor) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-1">
      {LABEL_COLORS.map((c) => (
        <Tooltip key={c} label={LABEL_COLOR_NAMES[c]}>
          <button
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={LABEL_COLOR_NAMES[c]}
            disabled={disabled}
            onClick={() => onChange(c)}
            style={inkOf(c)}
            className={cx(
              'vx-tag flex h-6 w-6 items-center justify-center rounded-vx-sm transition-shadow duration-[120ms] disabled:opacity-[.38]',
              value === c ? 'shadow-[inset_0_0_0_1.5px_var(--lc)]' : 'hover:shadow-[inset_0_0_0_1px_var(--lc)]',
            )}
          >
            <span aria-hidden className="vx-tag-dot h-2.5 w-2.5 rounded-full" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function LabelRow({ label, canEdit, onDelete }: { label: FileLabel; canEdit: boolean; onDelete: () => void }) {
  const ws = useVx((s) => s.workspaceId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: { name?: string; color?: LabelColor }) => {
    if (!ws) return;
    setError(null);
    try {
      await api.labels.update(ws, label.id, patch);
      await revalidateAnnotations();
      setEditing(false);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <li className="flex min-h-10 flex-col justify-center border-b border-vx-hair-soft py-1 last:border-b-0">
      <div className="flex items-center gap-2.5">
        {canEdit ? (
          <Menu
            items={LABEL_COLORS.map((c) => ({
              id: c,
              label: LABEL_COLOR_NAMES[c],
              icon: <LabelDot color={c} />,
              checked: c === label.color,
              onSelect: () => void save({ color: c }),
            }))}
            minWidth={160}
            trigger={(p) => (
              <button {...p} type="button" aria-label={`Colour of ${label.name}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-vx-sm hover:bg-vx-raise">
                <LabelDot color={label.color} className="h-2.5 w-2.5" />
              </button>
            )}
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center">
            <LabelDot color={label.color} className="h-2.5 w-2.5" />
          </span>
        )}
        {editing ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ name });
            }}
          >
            <Input
              size="sm"
              autoFocus
              value={name}
              maxLength={MAX_LABEL_NAME_CHARS}
              aria-label="Tag name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setName(label.name);
                  setEditing(false);
                }
              }}
              onBlur={() => (name.trim() && name !== label.name ? void save({ name }) : setEditing(false))}
            />
          </form>
        ) : (
          <span className="min-w-0 flex-1">
            <LabelChip label={label} size="md" />
          </span>
        )}
        <span className="vx-meta shrink-0 tabular-nums text-vx-text-3">
          {label.count} {label.count === 1 ? 'item' : 'items'}
        </span>
        {canEdit ? (
          <Menu
            align="end"
            minWidth={180}
            items={[
              { id: 'rename', label: 'Rename', icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => setEditing(true) },
              { id: 'del', label: 'Delete tag…', icon: <Trash size={16} strokeWidth={1.75} />, danger: true, onSelect: onDelete },
            ]}
            trigger={(p) => (
              <IconButton {...p} size="sm" label={`Actions for ${label.name}`}>
                <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
              </IconButton>
            )}
          />
        ) : null}
      </div>
      {error ? <p className="pl-[38px] pt-1 text-[13px] leading-5 text-vx-danger">{error}</p> : null}
    </li>
  );
}

/** Rendered once by the drive; opened through useAnnotationsUi.setManageOpen. */
export default function LabelsDialog() {
  const open = useAnnotationsUi((s) => s.manageOpen);
  const setOpen = useAnnotationsUi((s) => s.setManageOpen);
  const ws = useVx((s) => s.workspaceId);
  const canEdit = useVx((s) => currentRole(s) !== 'viewer');
  const { data } = useLabels();
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FileLabel | null>(null);
  const labels = data?.labels ?? [];
  const shownColor = color ?? nextLabelColor(labels);

  const add = async () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!ws || !n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.labels.create(ws, { name: n, color: shownColor });
      await revalidateAnnotations();
      setName('');
      setColor(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setError(null);
    setName('');
  };

  return (
    <>
      <Dialog
        open={open && !deleting}
        onClose={close}
        title="Tags"
        description={canEdit ? 'Everyone with access to this drive sees its tags.' : 'Tags of this drive. Only its owner and editors change them.'}
        width={480}
        error={error}
        footer={
          <Button variant="outline" onClick={close}>
            Done
          </Button>
        }
      >
        {canEdit ? (
          <form
            className="mb-3 flex flex-col gap-2 rounded-vx-sm border border-vx-hair bg-vx-surface-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="flex items-center gap-2">
              <Input size="sm" value={name} maxLength={MAX_LABEL_NAME_CHARS} placeholder="New tag" aria-label="New tag name" onChange={(e) => setName(e.target.value)} />
              <Button type="submit" size="sm" variant="tonal" loading={busy} disabled={!name.trim()}>
                Add
              </Button>
            </div>
            <ColorSwatches value={shownColor} onChange={setColor} disabled={busy} />
          </form>
        ) : null}
        {labels.length ? (
          <ul aria-label="Tags of this drive">
            {labels.map((l) => (
              <LabelRow key={`${l.id}:${l.name}`} label={l} canEdit={canEdit} onDelete={() => setDeleting(l)} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-[13px] leading-5 text-vx-text-3">{data ? 'No tags yet.' : 'Loading…'}</p>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        title="Delete this tag?"
        body={
          deleting ? (
            <>
              <LabelChip label={deleting} /> comes off {deleting.count} {deleting.count === 1 ? 'item' : 'items'}. The items themselves stay as they are.
            </>
          ) : null
        }
        confirmLabel="Delete tag"
        danger
        onConfirm={async () => {
          if (!ws || !deleting) return;
          await api.labels.remove(ws, deleting.id);
          const f = useAnnotationsUi.getState().filter;
          if (f?.labelId === deleting.id) useAnnotationsUi.getState().setFilter(null);
          await revalidateAnnotations();
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
