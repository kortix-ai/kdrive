'use client';

// Upload conflict (DESIGN §6.12): "notes.md and 2 more already exist." with the
// first five names, an "Apply to all" box (reused for the rest of this upload only),
// Keep both (default, ↵) · Replace. Esc cancels the upload.
import { useState } from 'react';
import { basename, dirname } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/components/ui/cx';
import { answerConflict, useUploadPrompts } from '@/lib/upload/prompts';

export function conflictHeadline(paths: readonly string[]): string {
  if (!paths.length) return 'Some items already exist.';
  const first = basename(paths[0]);
  if (paths.length === 1) return `${first} already exists.`;
  return `${first} and ${paths.length - 1} more already exist.`;
}

export default function ConflictDialog() {
  const prompt = useUploadPrompts((s) => s.conflict);
  const [all, setAll] = useState(false);
  if (!prompt) return null;
  const shown = prompt.paths.slice(0, 5);
  const more = prompt.paths.length - shown.length;
  const choose = (c: 'keep-both' | 'replace' | null) => {
    answerConflict(c, all);
    setAll(false);
  };
  return (
    <Dialog
      open
      title="Already exists"
      width={480}
      onClose={() => choose(null)}
      onSubmit={() => choose('keep-both')}
      footer={
        <>
          <Button variant="ghost" onClick={() => choose(null)} className="mr-auto">
            Cancel upload
          </Button>
          <Button variant="secondary" onClick={() => choose('replace')}>
            Replace
          </Button>
          <Button variant="primary" onClick={() => choose('keep-both')} kbd="↵">
            Keep both
          </Button>
        </>
      }
    >
      <p className="vx-body text-vx-text-1">{conflictHeadline(prompt.paths)}</p>
      <ul className="mt-3 border border-vx-hair">
        {shown.map((p) => (
          <li key={p} className="flex h-8 items-center gap-3 border-b border-vx-hair-soft px-3 last:border-b-0">
            <span className="vx-name min-w-0 flex-1 truncate text-vx-text-1">{basename(p)}</span>
            <span className="vx-meta max-w-[45%] truncate text-vx-text-4">{dirname(p)}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="vx-meta mt-2 text-vx-text-3">and {more} more</p> : null}
      <p className="vx-body mt-4 text-vx-text-3">
        Keep both saves the new copies as <span className="vx-mono text-vx-text-2">name (1).ext</span>. Replace makes the new files the current version; the old ones stay in history.
      </p>
      <label className="mt-4 flex cursor-pointer items-center gap-2">
        <input type="checkbox" className="peer sr-only" checked={all} onChange={(e) => setAll(e.target.checked)} />
        <span
          aria-hidden
          className={cx(
            'inline-flex h-3.5 w-3.5 items-center justify-center border font-mono text-[10px] leading-none peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[var(--vx-accent-edge)]',
            all ? 'border-[var(--pt-100)] bg-[var(--pt-100)] text-vx-text-inv' : 'border-vx-hair-strong text-transparent',
          )}
        >
          ✓
        </span>
        <span className="vx-ui text-vx-text-2">Apply to all</span>
        <span className="vx-meta text-vx-text-4">for the rest of this upload</span>
      </label>
    </Dialog>
  );
}
