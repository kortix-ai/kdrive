'use client';

import { useEffect, useRef } from 'react';

/**
 * Key specs: 'h', '?', '/', 'mod+z' (⌘ on macOS, Ctrl elsewhere), 'shift+u',
 * 'alt+x', 'escape', 'enter', 'space', 'delete', 'backspace', 'arrowup', 'f2',
 * and two-key sequences 'g d' (second key within 1 s).
 * Events from inputs, textareas, selects and contenteditable are ignored.
 */
export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function keyName(e: KeyboardEvent): string {
  if (e.key === ' ') return 'space';
  if (e.key === 'Esc') return 'escape';
  return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
}

/** True when `e` matches a single-chord spec such as 'mod+shift+z'. */
export function matchesChord(spec: string, e: KeyboardEvent, mac = isMac()): boolean {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop()!;
  const mods = new Set(parts);
  const wantMod = mods.has('mod') || mods.has('cmd') || mods.has('ctrl');
  const hasMod = mac ? e.metaKey : e.ctrlKey;
  if (wantMod !== hasMod) return false;
  if (!mac && !wantMod && e.metaKey) return false;
  if (mac && !wantMod && e.ctrlKey) return false;
  if (mods.has('alt') !== e.altKey) return false;
  const k = keyName(e);
  const isLetter = /^[a-z]$/.test(k);
  if (mods.has('shift')) {
    if (!e.shiftKey) return false;
  } else if (isLetter && e.shiftKey) {
    return false;
  }
  if (key === 'plus') return k === '+';
  return k === key;
}

export function useHotkeys(map: HotkeyMap, opts: { enabled?: boolean } = {}): void {
  const ref = useRef(map);
  ref.current = map;
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    let pending: { first: string; at: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const now = Date.now();
      const specs = Object.keys(ref.current);
      // sequences first ('g d')
      if (pending && now - pending.at < 1000) {
        for (const spec of specs) {
          const [a, b] = spec.split(' ');
          if (b && a === pending.first && matchesChord(b, e)) {
            e.preventDefault();
            pending = null;
            ref.current[spec](e);
            return;
          }
        }
      }
      pending = null;
      for (const spec of specs) {
        if (spec.includes(' ')) {
          const [a] = spec.split(' ');
          if (matchesChord(a, e)) {
            pending = { first: a, at: now };
            return;
          }
          continue;
        }
        if (matchesChord(spec, e)) {
          e.preventDefault();
          ref.current[spec](e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
