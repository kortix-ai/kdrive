'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

/** Copy state: flips to "Copied" for 1.2 s (no toast). */
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

/** Copy button: `outline` (the created-link field) or `text` (link rows); flips to an `ok` "Copied" for 1.2 s. */
export function CopyButton({
  text,
  className,
  variant = 'outline',
  size = 'sm',
  flashOnMount,
}: {
  text: string;
  className?: string;
  variant?: 'outline' | 'text';
  size?: 'xs' | 'sm';
  /** show "Copied" right away (the text was already copied, e.g. on create) */
  flashOnMount?: boolean;
}) {
  const [copied, copy, flash] = useCopied();
  useEffect(() => {
    if (flashOnMount) flash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const iconSize = 16;
  return (
    <Button
      size={size}
      variant={copied === true ? 'ok' : copied === 'failed' ? 'danger-text' : variant}
      onClick={() => void copy(text)}
      aria-live="polite"
      icon={copied === true ? <Check size={iconSize} strokeWidth={2} aria-hidden /> : variant === 'outline' ? <Copy size={iconSize} strokeWidth={1.75} aria-hidden /> : undefined}
      className={cx('min-w-[88px]', className)}
    >
      {copied === true ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  );
}

export default CopyButton;
