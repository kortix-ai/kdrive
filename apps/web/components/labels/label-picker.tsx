'use client';

// The Tags popover (context menu › Tags, the selection bar's tag button): a checkbox per
// tag of the drive (mixed when only some of the items carry it), "New tag…" to make one
// and put it on the items, and Manage tags…. Stays open while ticking; Esc or a click
// outside closes it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Settings2 } from 'lucide-react';
import { MAX_LABEL_NAME_CHARS, basename } from '@volumes/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/input';
import { placeInViewport } from '@/components/ui/menu';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { labelIndex, revalidateAnnotations, useAnnotationsUi, useLabels } from '@/lib/annotations';
import { useVx } from '@/lib/store';
import { LabelDot, nextLabelColor } from './label-chip';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

function PickerBody({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const ws = useVx((s) => s.workspaceId);
  const { data, mutate } = useLabels();
  const ix = labelIndex(data);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggle = async (labelId: string, on: boolean) => {
    if (!ws) return;
    setBusy(labelId);
    setError(null);
    try {
      await mutate(await api.labels.assign(ws, { labelId, paths, assigned: on }), { revalidate: false });
      void revalidateAnnotations();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!ws || !n) return;
    if (ix && [...ix.byId.values()].some((l) => l.name.toLowerCase() === n.toLowerCase())) {
      setError('A tag with that name already exists.');
      return;
    }
    setBusy('new');
    setError(null);
    try {
      const { label } = await api.labels.create(ws, { name: n, color: nextLabelColor(data?.labels ?? []) });
      await mutate(await api.labels.assign(ws, { labelId: label.id, paths, assigned: true }), { revalidate: false });
      void revalidateAnnotations();
      setName('');
      setAdding(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const title = paths.length === 1 ? basename(paths[0]) : `${paths.length} items`;
  return (
    <>
      <div className="vx-meta truncate px-2.5 pb-1 pt-1.5 text-vx-text-3" title={title}>
        Tags · {title}
      </div>
      <div className="max-h-[280px] overflow-y-auto" role="group" aria-label="Tags">
        {!data ? (
          <div className="flex h-8 items-center px-2.5">
            <Spinner size={14} />
          </div>
        ) : data.labels.length === 0 && !adding ? (
          <p className="px-2.5 py-1.5 text-[13px] leading-5 text-vx-text-3">No tags in this drive yet.</p>
        ) : (
          data.labels.map((l) => {
            const have = paths.filter((p) => ix?.byPath.get(p)?.some((x) => x.id === l.id)).length;
            const all = have === paths.length;
            return (
              <label
                key={l.id}
                className="flex h-8 cursor-pointer items-center gap-2.5 rounded-vx-sm px-2.5 text-[14px] leading-5 text-vx-text-1 transition-colors duration-[120ms] hover:bg-vx-raise"
              >
                <Checkbox checked={all} indeterminate={have > 0 && !all} label={l.name} disabled={!!busy} onChange={() => void toggle(l.id, !all)} />
                <LabelDot color={l.color} />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                {busy === l.id ? <Spinner size={12} /> : null}
              </label>
            );
          })
        )}
      </div>
      <div role="separator" className="-mx-1 my-1 h-px bg-vx-hair" />
      {adding ? (
        <form
          className="px-1.5 pb-1 pt-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            size="sm"
            autoFocus
            value={name}
            maxLength={MAX_LABEL_NAME_CHARS}
            placeholder="Tag name"
            aria-label="New tag name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
              }
            }}
            suffix={busy === 'new' ? <Spinner size={12} /> : '↵'}
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-8 w-full items-center gap-2.5 rounded-vx-sm px-2.5 text-left text-[14px] leading-5 text-vx-text-1 transition-colors duration-[120ms] hover:bg-vx-raise"
        >
          <Plus size={16} strokeWidth={1.75} className="text-vx-text-2" aria-hidden />
          New tag…
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          onClose();
          useAnnotationsUi.getState().setManageOpen(true);
        }}
        className="flex h-8 w-full items-center gap-2.5 rounded-vx-sm px-2.5 text-left text-[14px] leading-5 text-vx-text-1 transition-colors duration-[120ms] hover:bg-vx-raise"
      >
        <Settings2 size={16} strokeWidth={1.75} className="text-vx-text-2" aria-hidden />
        Manage tags…
      </button>
      {error ? <p className="px-2.5 pb-1.5 pt-1 text-[13px] leading-5 text-vx-danger">{error}</p> : null}
    </>
  );
}

/** Renders the open picker (useAnnotationsUi.picker), once, from the drive. */
export default function LabelPicker() {
  const picker = useAnnotationsUi((s) => s.picker);
  const close = useAnnotationsUi((s) => s.closePicker);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ws = useVx((s) => s.workspaceId);

  useEffect(() => close(), [ws, close]);

  useLayoutEffect(() => {
    if (!picker || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos(placeInViewport(picker.x, picker.y, r.width, r.height, window.innerWidth, window.innerHeight, picker.flipY));
  }, [picker]);

  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [picker, close]);

  if (!picker || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Tags"
      style={pos ? { left: pos.left, top: pos.top } : { left: picker.x, top: picker.y, opacity: 0 }}
      className={cx('vx-pop fixed z-[70] w-[260px] max-w-[calc(100vw-16px)] rounded-vx-md bg-vx-float p-1 shadow-vx-3 outline-none')}
    >
      <PickerBody key={picker.paths.join('\n')} paths={picker.paths} onClose={close} />
    </div>,
    document.body,
  );
}
