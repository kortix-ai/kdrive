'use client';

// A comment's body (plain text: line breaks kept, web addresses as links) and the box
// comments are written in (⌘/Ctrl+↵ posts, Esc cancels a reply or an edit).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MAX_COMMENT_CHARS } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that ends a sentence rather than an address. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** Splits text into plain runs and links (http and https only). */
export function linkify(text: string): ({ kind: 'text'; text: string } | { kind: 'link'; href: string; text: string })[] {
  const out: ({ kind: 'text'; text: string } | { kind: 'link'; href: string; text: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = TRAILING.exec(url)?.[0] ?? '';
    // Keep a closing parenthesis that belongs to the address: …/Foo_(bar)
    const keep = trail.startsWith(')') && url.slice(0, -trail.length).includes('(') ? 1 : 0;
    url = url.slice(0, url.length - trail.length + keep);
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'link', href: url, text: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function CommentBody({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cx('whitespace-pre-wrap break-words text-[14px] leading-[22px] text-vx-text-1 [overflow-wrap:anywhere]', className)}>
      {linkify(text).map((part, i) =>
        part.kind === 'link' ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-vx-text-1 underline decoration-vx-outline underline-offset-[3px] hover:decoration-vx-text-1">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export interface ComposerHandle {
  focus(): void;
}

/** A growing text box with a post button. `onSubmit` returns once posted (the box then clears). */
export const Composer = forwardRef<
  ComposerHandle,
  {
    placeholder: string;
    submitLabel: string;
    initial?: string;
    onSubmit: (body: string) => Promise<void>;
    onCancel?: () => void;
    autoFocus?: boolean;
    disabled?: boolean;
    compact?: boolean;
  }
>(function Composer({ placeholder, submitLabel, initial = '', onSubmit, onCancel, autoFocus, disabled, compact }, ref) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  const trimmed = value.trim();
  const over = value.length > MAX_COMMENT_CHARS;
  const can = !!trimmed && !over && !busy && !disabled && trimmed !== initial.trim();

  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cx(
          'rounded-vx-sm border bg-vx-field transition-[border-color,box-shadow] duration-[120ms] ease-vx',
          over ? 'border-vx-danger' : 'border-vx-hair-strong hover:border-vx-outline focus-within:border-transparent focus-within:shadow-[inset_0_0_0_2px_var(--vx-focus)]',
          disabled && 'opacity-[.6]',
        )}
      >
        <textarea
          ref={box}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled || busy}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={compact ? 1 : 2}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape' && onCancel) {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          className="block max-h-[240px] min-h-9 w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-5 text-vx-text-1 outline-none [field-sizing:content] placeholder:text-vx-text-3"
        />
      </div>
      {error ? <p className="text-[13px] leading-5 text-vx-danger">{error}</p> : null}
      {value || onCancel ? (
        <div className="flex items-center gap-2">
          <span className={cx('vx-meta min-w-0 flex-1 truncate', over ? 'text-vx-danger' : 'text-vx-text-3')}>
            {value.length > MAX_COMMENT_CHARS - 400 ? `${value.length.toLocaleString()} / ${MAX_COMMENT_CHARS.toLocaleString()}` : mac ? '⌘↵ to post' : 'Ctrl+↵ to post'}
          </span>
          {onCancel ? (
            <Button size="xs" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <Button size="xs" variant="primary" onClick={() => void submit()} loading={busy} disabled={!can}>
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
});
