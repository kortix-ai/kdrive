import { cx } from '@/components/ui/cx';

/**
 * One vocabulary for kinds of change, shared by drive compare, the proposal inbox and the proposal review
 * (and matching the landing's proposal mock): sentence-case words for tags, one Mono sign for compact columns.
 *   added +   changed M   moved R   removed −   copied C   new folder +
 */
export type ChangeKind = 'added' | 'changed' | 'moved' | 'removed' | 'copied' | 'folder';

export const CHANGE_KINDS: Record<ChangeKind, { word: string; sign: string; signClass: string }> = {
  added: { word: 'Added', sign: '+', signClass: 'text-vx-add-fg' },
  changed: { word: 'Changed', sign: 'M', signClass: 'text-vx-text-2' },
  moved: { word: 'Moved', sign: 'R', signClass: 'text-vx-text-3' },
  removed: { word: 'Removed', sign: '−', signClass: 'text-vx-del-fg' },
  copied: { word: 'Copied', sign: 'C', signClass: 'text-vx-text-3' },
  folder: { word: 'New folder', sign: '+', signClass: 'text-vx-text-3' },
};

/**
 * A change tag (UNIFY-SPEC §12.1, like the landing mock): Mono 11 sentence case, h 18, r2, padding 0 6,
 * 1 px hair-strong, text-2. `removed` takes the delete colours.
 */
export function ChangeTag({ kind, className }: { kind: ChangeKind; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-vx-xs px-1.5 font-mono text-[11px] leading-none',
        kind === 'removed' ? 'bg-vx-del-bg text-vx-del-fg' : 'text-vx-text-2 shadow-[inset_0_0_0_1px_var(--vx-hair-strong)]',
        className,
      )}
    >
      {CHANGE_KINDS[kind].word}
    </span>
  );
}

/** The compact status sign at a row's end (Mono 12, tinted per kind). */
export function ChangeSign({ kind, className }: { kind: ChangeKind; className?: string }) {
  const k = CHANGE_KINDS[kind];
  return (
    <span className={cx('w-4 shrink-0 text-center font-mono text-[12px] font-medium', k.signClass, className)} title={k.word} aria-label={k.word}>
      {k.sign}
    </span>
  );
}
