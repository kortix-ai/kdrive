'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, X } from 'lucide-react';
import { cx } from './cx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** One meta line under the title. */
  description?: React.ReactNode;
  /** 32 px leading icon in the head (e.g. a FileIcon). */
  icon?: React.ReactNode;
  /** 420 confirm · 480 default · 520 restore · 560 share / keyboard · 640 wide */
  width?: 420 | 480 | 520 | 560 | 640;
  children: React.ReactNode;
  /** Right-aligned buttons: text/outline Cancel first, the primary last. */
  footer?: React.ReactNode;
  /** A notes line under the footer, on surface-2 (e.g. the share privacy note). */
  note?: React.ReactNode;
  /** Called on ↵ (outside textareas) when set. */
  onSubmit?: () => void;
  busy?: boolean;
  error?: string | null;
  className?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Dialog (DESIGN-v2 §5): r16 float over the scrim, shadow-4; head 20/600 title + meta + ✕;
 * right-aligned footer. ↵ submits, Esc closes, focus is trapped and returned.
 * Below 720 px it becomes a bottom sheet with stacked full-width buttons.
 */
export function Dialog({ open, onClose, title, description, icon, width = 480, children, footer, note, onSubmit, busy, error, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus],input:not([type=hidden]),textarea,select,button:not([data-dialog-close])');
      el?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        if (!busy) onClose();
      } else if (e.key === 'Enter' && onSubmit && !(e.target instanceof HTMLTextAreaElement) && !e.isComposing) {
        e.preventDefault();
        if (!busy) onSubmit();
      } else if (e.key === 'Tab' && ref.current) {
        const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose, onSubmit, busy]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="dlg-fade fixed inset-0 z-50 flex items-start justify-center bg-vx-scrim px-4 pt-[12vh] max-[720px]:items-end max-[720px]:px-0 max-[720px]:pt-0"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cx(
          'dlg-pop flex max-h-[80vh] w-full flex-col overflow-hidden rounded-vx-lg bg-vx-float text-vx-text-2 shadow-vx-4',
          'max-[720px]:max-h-[92dvh] max-[720px]:max-w-none max-[720px]:rounded-b-none',
          className,
        )}
        style={{ maxWidth: width }}
      >
        <div className="flex shrink-0 items-start gap-3 px-6 pb-4 pt-5">
          {icon ? <span className="mt-0.5 inline-flex shrink-0">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[20px] font-semibold leading-[26px] tracking-[-0.02em] text-vx-text-1">
              {title}
            </h2>
            {description ? (
              <div id={descId} className="vx-meta mt-1 text-vx-text-3">
                {description}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            data-dialog-close
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            className="-mr-2 -mt-1.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-vx-text-2 transition-colors duration-[120ms] hover:bg-vx-surface-3 hover:text-vx-text-1 disabled:opacity-[.38]"
          >
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-2">{children}</div>
        {error ? (
          <div role="alert" className="mx-6 mt-2 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-del-fg">
            <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0">{error}</span>
          </div>
        ) : null}
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 px-6 pb-4 pt-4 max-[720px]:flex-col-reverse max-[720px]:items-stretch max-[720px]:[&>*]:w-full">
            {footer}
          </div>
        ) : null}
        {note ? <div className="vx-meta flex shrink-0 items-center gap-2 bg-vx-surface-2 px-6 py-3 text-vx-text-3">{note}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export default Dialog;
