'use client';

import { useEffect, useRef, useState } from 'react';

// Small shared pieces for the landing mocks (LANDING-SPEC §7): file icons, an
// accessible tab strip, and a copy button that confirms for 1.4 s.

export function FileIcon({ dir = false, ghost = false }: { dir?: boolean; ghost?: boolean }) {
  return <span className={`kd-ficon${dir ? ' is-dir' : ''}${ghost ? ' is-ghost' : ''}`} aria-hidden="true" />;
}

/** A tablist with roving focus: arrow keys move and select, Home/End jump. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
}: {
  label: string;
  tabs: readonly { id: T; label: React.ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  idBase: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="kd-tabs">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.id}`}
          aria-controls={`${idBase}-panel`}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          className="kd-tabs__tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A timer that clears itself on unmount. */
export function useFlag(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const fire = () => {
    setOn(true);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setOn(false), ms);
  };
  return [on, fire];
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, fire] = useFlag(1400);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the mock still confirms.
    }
    fire();
  };
  return (
    <button type="button" className={`kd-mbtn${className ? ` ${className}` : ''}`} onClick={copy} aria-live="polite">
      {copied ? 'Copied' : label}
    </button>
  );
}
