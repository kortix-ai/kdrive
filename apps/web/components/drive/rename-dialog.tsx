'use client';

// Inline rename (UNIFY-SPEC §14.2 "renaming"): a 28 px r4 field (field fill, hair-strong
// border, the inset focus ring) in place of
// the name, base name preselected (extension excluded). ↵ saves, Esc cancels,
// blur saves when the name changed and is valid.
import { useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
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
          'h-7 w-full min-w-0 rounded-vx-sm border bg-vx-field px-2 text-[14px] font-medium leading-5 text-vx-text-1 outline-none transition-[border-color,box-shadow] duration-[120ms]',
          error
            ? 'border-vx-danger shadow-[inset_0_0_0_1px_var(--vx-danger)]'
            : 'border-vx-hair-strong hover:border-vx-outline focus:border-transparent focus:shadow-[inset_0_0_0_2px_var(--vx-focus)]',
        )}
      />
      {error ? (
        <span
          role="alert"
          className="absolute left-0 top-full z-20 mt-1.5 flex items-center gap-1.5 whitespace-nowrap rounded-vx-sm bg-vx-float px-2.5 py-1.5 text-[13px] leading-5 text-vx-danger shadow-vx-3"
        >
          <CircleAlert size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
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
