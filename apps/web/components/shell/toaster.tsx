'use client';

import { usePathname } from 'next/navigation';
import { CircleAlert, CircleCheck, RotateCcw, X } from 'lucide-react';
import { useVx, type Toast } from '@/lib/store';
import { cx } from '@/components/ui/cx';

const onDriveRoute = (pathname: string) => pathname === '/drive' || pathname.startsWith('/drive/');
/** Routes drawn inside the app shell (sidebar on the left). */
const inShell = (pathname: string) => !(pathname === '/signin' || pathname.startsWith('/signin/') || pathname.startsWith('/s/'));

/** Where the stack sits: 16 px above the history strip on /drive (never over its dots), 16 px from the bottom elsewhere. */
export function toastBottom(pathname: string): string {
  return onDriveRoute(pathname) ? 'calc(var(--vx-strip-h) + 32px)' : '16px';
}

function LeadIcon({ t }: { t: Toast }) {
  if (t.kind === 'error') return <CircleAlert size={16} strokeWidth={1.75} className="shrink-0 text-vx-danger" aria-hidden />;
  if (/^(Restored|Undone)\b/.test(t.message)) return <RotateCcw size={16} strokeWidth={1.75} className="shrink-0 text-vx-past" aria-hidden />;
  if (t.kind === 'success') return <CircleCheck size={16} strokeWidth={1.75} className="shrink-0 text-vx-ok" aria-hidden />;
  return null;
}

/**
 * Snackbars (DESIGN-v2 §5, §6.20): inverse, r8, 48 px, bottom-left of main, at most 3 stacked
 * 8 px apart. An undo toast drains a 3 px bar over its duration; hover pauses it.
 */
export function Toaster() {
  const toasts = useVx((s) => s.toasts);
  const dismiss = useVx((s) => s.dismissToast);
  const undo = useVx((s) => s.undo);
  const pathname = usePathname() ?? '/';
  return (
    <div
      aria-live="polite"
      data-shell={inShell(pathname) ? 'true' : 'false'}
      style={{ bottom: toastBottom(pathname) }}
      className="vx-toasts pointer-events-none fixed z-[80] flex flex-col items-start gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="vx-toast pointer-events-auto relative flex min-h-11 w-full min-w-[min(320px,100%)] max-w-[520px] items-center gap-3 overflow-hidden rounded-vx-sm bg-vx-float py-1.5 pl-3.5 pr-1.5 text-vx-text-1 shadow-vx-3"
        >
          <LeadIcon t={t} />
          <span className="min-w-0 flex-1 text-[14px] leading-5">{t.message}</span>
          {t.undoActionId ? (
            <button
              type="button"
              onClick={() => void undo(t.id)}
              title="Undo (⌘Z)"
              className="inline-flex h-8 shrink-0 items-center rounded-vx-sm px-2.5 text-[14px] font-semibold text-vx-text-1 underline-offset-[3px] hover:underline"
            >
              Undo
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-vx-sm text-vx-text-2 hover:bg-vx-raise hover:text-vx-text-1"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
          {t.undoActionId ? (
            <span className={cx('vx-drain absolute bottom-0 left-0 h-0.5 w-full bg-vx-accent')} style={{ animationDuration: `${t.durationMs}ms` }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default Toaster;
