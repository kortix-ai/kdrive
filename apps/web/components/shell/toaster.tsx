'use client';

import { usePathname } from 'next/navigation';
import { useVx } from '@/lib/store';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/kbd';

const RULE = { info: 'var(--vx-text-3)', success: 'var(--vx-ok)', error: 'var(--vx-danger)' } as const;

/** Where the stack sits: 12 px above the Time Strip on /drive (never over its ticks), 16 px from the bottom elsewhere. */
export function toastBottom(pathname: string): string {
  return pathname === '/drive' || pathname.startsWith('/drive/') ? 'calc(var(--vx-strip-h) + 12px)' : '16px';
}

/**
 * Bottom-centre toasts (max 3), one fixed width so stacked toasts line up
 * (DESIGN §6.19). An undo toast drains over UNDO_WINDOW_MS; hover pauses the bar.
 */
export function Toaster() {
  const toasts = useVx((s) => s.toasts);
  const dismiss = useVx((s) => s.dismissToast);
  const undo = useVx((s) => s.undo);
  const pathname = usePathname() ?? '/';
  return (
    <div
      aria-live="polite"
      style={{ bottom: toastBottom(pathname) }}
      className="pointer-events-none fixed left-1/2 z-[80] flex w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-stretch gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="vx-toast pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden border border-vx-hair-strong bg-vx-float py-2.5 pl-4 pr-2 shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)]"
          style={{ boxShadow: `inset 2px 0 0 ${RULE[t.kind]}` }}
        >
          <span className="vx-name flex-1 text-vx-text-1">{t.message}</span>
          {t.undoActionId ? (
            <button
              type="button"
              onClick={() => void undo(t.id)}
              className="inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[12px] font-medium text-vx-text-1 hover:bg-vx-surface-2"
            >
              Undo <Kbd>⌘Z</Kbd>
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="px-1.5 font-mono text-[12px] text-vx-text-4 hover:text-vx-text-1">
            ✕
          </button>
          {t.undoActionId ? (
            <span className={cx('vx-drain absolute bottom-0 left-0 h-px w-full bg-vx-text-3')} style={{ animationDuration: `${t.durationMs}ms` }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default Toaster;
