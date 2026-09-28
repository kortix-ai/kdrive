'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui/cx';

/** Writes `text` to the clipboard (async API, with a hidden-textarea fallback). Resolves false when both fail. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Platinum copy button: the label flips to "Copied ✓" for 1.2 s (no toast). */
export function useCopied(): [boolean | 'failed', (text: string) => Promise<void>, () => void] {
  const [state, setState] = useState<boolean | 'failed'>(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (t.current) clearTimeout(t.current);
  }, []);
  const copy = async (text: string) => {
    const ok = await copyText(text);
    setState(ok ? true : 'failed');
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setState(false), 1200);
  };
  const flash = () => {
    setState(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setState(false), 1200);
  };
  return [state, copy, flash];
}

export function CopyButton({
  text,
  className,
  size = 'sm',
  flashOnMount,
}: {
  text: string;
  className?: string;
  size?: 'sm' | 'md';
  /** show "Copied ✓" right away (the text was already copied, e.g. on create) */
  flashOnMount?: boolean;
}) {
  const [copied, copy, flash] = useCopied();
  useEffect(() => {
    if (flashOnMount) flash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-live="polite"
      className={cx(
        'inline-flex shrink-0 items-center justify-center border px-2.5 font-mono text-[12px] font-medium transition-colors duration-[120ms]',
        size === 'sm' ? 'h-7 min-w-[84px]' : 'h-8 min-w-[92px]',
        copied === true ? 'border-vx-hair-strong text-vx-text-1' : copied === 'failed' ? 'border-vx-danger-edge text-vx-danger' : 'border-vx-hair text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1',
        className,
      )}
    >
      {copied === true ? 'Copied ✓' : copied === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

export default CopyButton;
