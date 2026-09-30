'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, X } from 'lucide-react';
import { cx } from './cx';
import { INITIAL_FOCUS_SELECTOR, createEnterGate, createEnterTracker, enterSubmits } from './dialog-keys';

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
  /**
   * Called on ↵ when set: from a text field, a checkbox or the dialog itself; never from a
   * focused button, link or other control that handles Enter itself, nor while the primary
   * (last footer) button is disabled.
   */
  onSubmit?: () => void;
  busy?: boolean;
  error?: string | null;
  className?: string;
}

/** Page-wide ↵ state, so a dialog knows whether the key was already down when it opened. */
const enterKey = createEnterTracker();
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => enterKey.keydown(e), true);
  window.addEventListener('keyup', (e) => enterKey.keyup(e), true);
  window.addEventListener('blur', () => enterKey.reset());
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Dialog (DESIGN-v2 §5): r16 float over the scrim, shadow-4; head 20/600 title + meta + ✕;
 * right-aligned footer. ↵ submits, Esc closes, focus is trapped and returned.
 * Below 720 px it becomes a bottom sheet with stacked full-width buttons.
 */
export function Dialog({ open, onClose, title, description, icon, width = 480, children, footer, note, onSubmit, busy, error, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // The latest handlers, read at key time. Callers pass inline functions (a new one every
  // render); the open effect must not re-run for them, or each re-render (data arriving, an
  // SWR revalidate) would hand focus back to the opener and then to the dialog, and a ↵ meant
  // for a focused Cancel would land on the dialog and submit.
  const live = useRef({ onClose, onSubmit, busy });
  useLayoutEffect(() => {
    live.current = { onClose, onSubmit, busy };
  });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // A ↵ already down (the press that opened this dialog, or a held key) is not a choice.
    const gate = createEnterGate(enterKey.isDown());
    // Focus the first text field; otherwise the dialog itself (so ↵ runs the primary action and
    // Tab reaches Cancel). Never a footer button: ↵ on a focused Cancel must cancel. A field
    // React already focused (`autoFocus`) keeps focus. Runs once per opening.
    const t = setTimeout(() => {
      const box = ref.current;
      if (!box || box.contains(document.activeElement)) return;
      (box.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR) ?? box).focus();
    }, 0);
    const onKeyUp = (e: KeyboardEvent) => gate.keyup(e);
    const onKey = (e: KeyboardEvent) => {
      const { onClose, onSubmit, busy } = live.current;
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        if (!busy) onClose();
      } else if (e.key === 'Enter' && onSubmit) {
        const box = ref.current;
        const target = e.target instanceof HTMLElement ? e.target : null;
        // Nothing has focus: the focused element was just removed (a folder row replaced by
        // its loading state). That ↵ was meant for it, not for the primary action: it only
        // brings focus back into the dialog.
        if (!target || target === document.body || target === document.documentElement) {
          e.preventDefault();
          box?.focus();
          return;
        }
        // Only a fresh press made while open; the element focused now decides what it does.
        if (!gate.accepts(e)) return;
        const inDialog = !!box?.contains(target);
        const buttons = footerRef.current?.querySelectorAll('button');
        const primary = buttons?.length ? buttons[buttons.length - 1] : null;
        const primaryDisabled = !!primary && (primary.disabled || primary.getAttribute('aria-disabled') === 'true' || primary.getAttribute('aria-busy') === 'true');
        // Anything else keeps its own Enter (a focused Cancel cancels, a folder row opens).
        if (!enterSubmits(target, { inDialog, primaryDisabled })) return;
        e.preventDefault();
        if (!busy) onSubmit();
      } else if (e.key === 'Tab' && ref.current) {
        const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (document.activeElement === ref.current || !ref.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      // Closed (or unmounted): focus goes back to what opened the dialog.
      prev?.focus?.();
    };
  }, [open]);

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
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cx(
          'dlg-pop flex max-h-[80vh] w-full flex-col overflow-hidden rounded-vx-lg bg-vx-float text-vx-text-2 shadow-vx-4 outline-none',
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
          <div ref={footerRef} className="flex shrink-0 items-center justify-end gap-2 px-6 pb-4 pt-4 max-[720px]:flex-col-reverse max-[720px]:items-stretch max-[720px]:[&>*]:w-full">
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
