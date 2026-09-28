'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** 420 confirm · 480 default · 520 restore · 560 share */
  width?: 420 | 480 | 520 | 560 | 640;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Called on ↵ (outside textareas) when set. */
  onSubmit?: () => void;
  busy?: boolean;
  error?: string | null;
}

/** Flat dialog: --vx-float frame, mono label head, right-aligned footer; Esc closes. */
export function Dialog({ open, onClose, title, width = 480, children, footer, onSubmit, busy, error }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus],input,textarea,select,button:not([data-dialog-close])');
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
    <div className="dlg-fade fixed inset-0 z-50 flex items-start justify-center bg-vx-scrim pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="dlg-pop flex max-h-[76vh] max-w-[calc(100vw-32px)] flex-col border border-vx-hair-strong bg-vx-float shadow-[0_24px_64px_-24px_rgba(0,0,0,.7)]"
        style={{ width }}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-vx-hair px-6">
          <div className="vx-label text-vx-text-2">{title}</div>
          <button data-dialog-close aria-label="Close" onClick={onClose} disabled={busy} className="font-mono text-[12px] text-vx-text-4 hover:text-vx-text-1">
            ESC
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>
        {error ? <div className="mx-6 mb-3 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{error}</div> : null}
        {footer ? <div className="flex shrink-0 items-center justify-end gap-2 border-t border-vx-hair px-6 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export default Dialog;
