'use client';

// Corner-bracket drop target (DESIGN §6.12, signature 4). Dragging files from
// the OS over /drive snaps four machined brackets onto the main area, or onto
// the folder row / tile / crumb under the pointer, with one mono readout:
//   DROP 3 ITEMS → q3-report/ · 1 VERSION
// Red when storage is already full, amber in the past (uploads are refused).
// Drops keep the folder tree, empty folders included.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
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
}

function findTarget(el: EventTarget | null, fallbackDir: string): Target | null {
  const node = el instanceof Element ? el : null;
  const hit = node?.closest<HTMLElement>('[data-vx-drop-dir]');
  if (hit?.dataset.vxDropDir) {
    const r = hit.getBoundingClientRect();
    return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, dir: hit.dataset.vxDropDir, folder: true };
  }
  const main = document.querySelector<HTMLElement>('.vx-main');
  if (!main) return null;
  const r = main.getBoundingClientRect();
  return { rect: { left: r.left + 8, top: r.top + 8, width: r.width - 16, height: r.height - 16 }, dir: fallbackDir, folder: false };
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
        if (prev && prev.dir === t.dir && prev.rect.left === t.rect.left && prev.rect.top === t.rect.top && prev.rect.width === t.rect.width && prev.rect.height === t.rect.height) return prev;
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
  const tone = past ? 'text-vx-past' : full ? 'text-vx-danger' : 'text-vx-text-1';
  const dest = target.dir === '/' ? 'My Drive/' : `${basename(target.dir)}/`;
  const what = count > 0 ? `${count} ${count === 1 ? 'ITEM' : 'ITEMS'}` : 'FILES';
  // The folder keeps its real casing ("Photos" vs "photos"); only the fixed words are upper-cased.
  const readout: React.ReactNode = past ? (
    'GO BACK TO NOW TO UPLOAD'
  ) : full && usage ? (
    `YOUR ${formatBytes(usage.quotaBytes).toUpperCase()} IS FULL`
  ) : (
    <>
      DROP {what} → <span className="normal-case tracking-normal">{dest}</span> · 1 VERSION
    </>
  );
  const { left, top, width, height } = target.rect;

  return (
    <div className={cx(s.dropFrame, tone, 'z-[45]')} style={{ left, top, width, height }} aria-live="polite">
      <span key={`tl-${target.dir}`} className={cx(s.bracket, s.bracketTL)} style={{ left: 0, top: 0 }} />
      <span key={`tr-${target.dir}`} className={cx(s.bracket, s.bracketTR)} style={{ right: 0, top: 0 }} />
      <span key={`bl-${target.dir}`} className={cx(s.bracket, s.bracketBL)} style={{ left: 0, bottom: 0 }} />
      <span key={`br-${target.dir}`} className={cx(s.bracket, s.bracketBR)} style={{ right: 0, bottom: 0 }} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={cx(
            'vx-label whitespace-nowrap border bg-vx-float px-2 py-1 tracking-[0.14em]',
            past ? 'border-vx-past-edge text-vx-past' : full ? 'border-vx-danger-edge text-vx-danger' : 'border-vx-hair-strong text-vx-text-1',
            target.folder && height < 80 && 'translate-y-[calc(50%+14px)]',
          )}
        >
          {readout}
        </span>
      </div>
    </div>
  );
}
