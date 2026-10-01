'use client';

// OS drop target (DESIGN-v2 §6.13). Dragging files from the OS over /drive draws a 2 px
// dashed accent-edge ring with a light accent-wash tint on the drive sheet, or on the folder
// row / card / crumb under the pointer, with one centred float label (r4, shadow-3):
//   Drop 3 items → q3-report · 1 version
// Danger when storage is already full, amber in the past (uploads are refused).
// Drops keep the folder tree, empty folders included.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CircleAlert, Clock, Upload } from 'lucide-react';
import { basename, formatBytes } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { useUsage } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { collectDrop, dragItemCount, hasFiles } from '@/lib/upload/walk';
import { startUpload } from '@/lib/upload/uploads';
import s from './drive.module.css';

interface Target {
  rect: { left: number; top: number; width: number; height: number };
  dir: string;
  folder: boolean;
  radius: string;
}

function findTarget(el: EventTarget | null, fallbackDir: string): Target | null {
  const node = el instanceof Element ? el : null;
  const hit = node?.closest<HTMLElement>('[data-vx-drop-dir]');
  if (hit?.dataset.vxDropDir) {
    const r = hit.getBoundingClientRect();
    return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, dir: hit.dataset.vxDropDir, folder: true, radius: getComputedStyle(hit).borderRadius || 'var(--vx-r-sm)' };
  }
  const main = document.querySelector<HTMLElement>('.vx-main');
  if (!main) return null;
  const r = main.getBoundingClientRect();
  return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, dir: fallbackDir, folder: false, radius: getComputedStyle(main).borderRadius || 'var(--vx-r-lg)' };
}

export default function GlobalDropZone() {
  const pathname = usePathname() ?? '';
  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/');
  const past = useVx((st) => !!st.timeTravel);
  const ws = useVx((st) => st.workspaceId);
  const { data: usage } = useUsage();
  const [target, setTarget] = useState<Target | null>(null);
  const [count, setCount] = useState(0);
  const depth = useRef(0);
  const stateRef = useRef({ onDrive, past, ws });
  stateRef.current = { onDrive, past, ws };

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setTarget(null);
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer) || !stateRef.current.onDrive) return;
      depth.current++;
      e.preventDefault();
      setCount(dragItemCount(e.dataTransfer));
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      if (!stateRef.current.onDrive) {
        // Off the drive a dropped file would replace the app: refuse the drop.
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = stateRef.current.past ? 'none' : 'copy';
      const t = findTarget(e.target, useVx.getState().path);
      setTarget((prev) => {
        if (!t) return null;
        if (prev && prev.dir === t.dir && prev.rect.left === t.rect.left && prev.rect.top === t.rect.top && prev.rect.width === t.rect.width && prev.rect.height === t.rect.height && prev.radius === t.radius) return prev;
        return t;
      });
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) reset();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      const st = stateRef.current;
      e.preventDefault();
      if (!st.onDrive) return;
      const t = findTarget(e.target, useVx.getState().path);
      reset();
      const store = useVx.getState();
      if (st.past) {
        store.toast({ kind: 'info', message: 'Go back to now to upload.' });
        return;
      }
      if (!e.dataTransfer || !t) return;
      const promise = collectDrop(e.dataTransfer); // captures entries synchronously
      void promise
        .then((sources) => {
          if (!sources.files.length && !sources.dirs.length) {
            store.toast({ kind: 'info', message: 'Nothing to upload in that drop.' });
            return;
          }
          startUpload({ workspaceId: st.ws, basePath: t.dir, sources });
        })
        .catch(() => store.toast({ kind: 'error', message: "Couldn't read the dropped files." }));
    };
    const onEnd = () => reset();
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
    };
  }, []);

  if (!target || !onDrive) return null;

  const full = !!usage && usage.quotaBytes > 0 && usage.usedBytes >= usage.quotaBytes;
  const dest = target.dir === '/' ? 'My Drive' : basename(target.dir);
  const what = count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : 'files';
  const readout = past
    ? 'Go back to now to upload'
    : full && usage
      ? `Your ${formatBytes(usage.quotaBytes)} is full`
      : `Drop ${what} → ${dest} · 1 version`;
  const { left, top, width, height } = target.rect;
  // Small targets (a row, a crumb): the pill sits just under the ring instead of inside it.
  const below = target.folder && height < 80;

  return (
    <div
      className={cx(s.dropFrame, target.folder && s.folder, past ? s.past : full ? s.danger : null, 'z-[45]')}
      style={{ left, top, width, height, borderRadius: target.radius }}
      aria-live="polite"
    >
      <div className={cx('absolute inset-x-0 flex justify-center', below ? 'top-full mt-2' : 'inset-y-0 items-center')}>
        <span
          className={cx(
            'inline-flex h-9 max-w-[calc(100vw-32px)] items-center gap-2 truncate whitespace-nowrap rounded-vx-sm bg-vx-float px-3 text-[14px] font-medium leading-5 shadow-vx-3',
            past ? 'text-vx-past' : full ? 'text-vx-danger' : 'text-vx-text-1',
          )}
        >
          {past ? <Clock size={16} strokeWidth={1.75} className="shrink-0" aria-hidden /> : full ? <CircleAlert size={16} strokeWidth={1.75} className="shrink-0" aria-hidden /> : <Upload size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-2" aria-hidden />}
          <span className="truncate">{readout}</span>
        </span>
      </div>
    </div>
  );
}
