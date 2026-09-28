'use client';

// Inline rename (DESIGN §7 FileRow "renaming"): Inter input in place of the
// name, base name preselected (extension excluded). ↵ saves, Esc cancels,
// blur saves when the name changed and is valid.
import { useLayoutEffect, useRef, useState } from 'react';
import { validateName, type FileEntry } from '@volumes/shared';
import { cx } from '@/components/ui/cx';

/** Error text for a proposed name in a folder, or null when it is fine. */
export function nameError(name: string, siblings: readonly { name: string; path: string }[], selfPath?: string): string | null {
  const err = validateName(name);
  if (err) return err;
  if (siblings.some((s) => s.path !== selfPath && s.name === name)) return `"${name}" already exists here.`;
  return null;
}

/** Length of the part to preselect: the name without its last extension (files), or all (folders, dotfiles). */
export function stemLength(name: string, isDir: boolean): number {
  if (isDir) return name.length;
  const i = name.lastIndexOf('.');
  return i > 0 ? i : name.length;
}

export function NameInput({
  initial,
  selectTo,
  validate,
  onSubmit,
  onCancel,
  label,
  className,
}: {
  initial: string;
  selectTo: number;
  validate: (name: string) => string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const done = useRef(false);
  const name = value.trim();
  const error = touched ? validate(name) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, selectTo);
  }, [selectTo]);

  const submit = () => {
    if (done.current) return;
    const err = validate(name);
    if (err) {
      setTouched(true);
      return false;
    }
    done.current = true;
    onSubmit(name);
    return true;
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <span className={cx('relative flex min-w-0 flex-1 items-center', className)} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          setTouched(true);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (done.current) return;
          if (name === initial || validate(name)) cancel();
          else submit();
        }}
        className={cx(
          'vx-name h-6 w-full min-w-0 border bg-vx-surface-2 px-1.5 text-vx-text-1 outline-none',
          error ? 'border-vx-danger' : 'border-vx-hair-strong',
        )}
      />
      {error ? (
        <span role="alert" className="vx-meta absolute left-0 top-full z-20 mt-1 whitespace-nowrap border border-vx-hair-strong bg-vx-float px-2 py-1 text-vx-danger shadow-[0_12px_32px_-12px_rgba(0,0,0,.6)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Rename in place: base name preselected. */
export function RenameInput({
  entry,
  siblings,
  onSubmit,
  onCancel,
  className,
}: {
  entry: FileEntry;
  siblings: readonly FileEntry[];
  onSubmit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <NameInput
      initial={entry.name}
      selectTo={stemLength(entry.name, entry.type === 'dir')}
      validate={(n) => (n === entry.name ? null : nameError(n, siblings, entry.path))}
      onSubmit={(n) => (n === entry.name ? onCancel() : onSubmit(n))}
      onCancel={onCancel}
      label={`Rename ${entry.name}`}
      className={className}
    />
  );
}

export default RenameInput;
