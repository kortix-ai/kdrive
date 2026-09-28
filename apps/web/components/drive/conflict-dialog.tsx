'use client';

// Upload conflict (DESIGN-v2 §6.13, 480 px): "notes.md and 2 more already exist." with the
// first five names in a surface-2 r12 box, an "Apply to all" checkbox (reused for the rest of this upload only),
// Keep both (default, ↵) · Replace. Esc cancels the upload.
import { useState } from 'react';
import { basename, dirname } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { FileIcon } from '@/components/ui/file-icon';
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
      title={conflictHeadline(prompt.paths)}
      description="Keep both, or replace what is there."
      width={480}
      onClose={() => choose(null)}
      onSubmit={() => choose('keep-both')}
      footer={
        <>
          <Button variant="ghost" onClick={() => choose(null)} className="mr-auto max-[720px]:mr-0">
            Cancel upload
          </Button>
          <Button variant="outline" onClick={() => choose('replace')}>
            Replace
          </Button>
          <Button variant="primary" onClick={() => choose('keep-both')} kbd="↵">
            Keep both
          </Button>
        </>
      }
    >
      <ul className="rounded-vx-md bg-vx-surface-2 p-1">
        {shown.map((p) => (
          <li key={p} className="flex h-10 items-center gap-3 px-3">
            <FileIcon name={basename(p)} type="file" size={24} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-vx-text-1">{basename(p)}</span>
            <span className="vx-meta max-w-[45%] truncate text-vx-text-3" title={dirname(p)}>
              {dirname(p) === '/' ? 'My Drive' : dirname(p)}
            </span>
          </li>
        ))}
        {more > 0 ? <li className="vx-meta px-3 pb-2 pt-1 text-vx-text-3">and {more} more</li> : null}
      </ul>
      <p className="vx-body mt-4 text-vx-text-2">
        Keep both saves the new copies as <span className="font-medium text-vx-text-1">name (1).ext</span>. Replace makes the new files the current version; the old
        ones stay in history.
      </p>
      <label className="mt-4 flex cursor-pointer items-center gap-3">
        <Checkbox checked={all} onChange={(c) => setAll(c)} label="Apply to all" />
        <span className="text-[14px] font-medium leading-5 text-vx-text-1">Apply to all</span>
        <span className="vx-meta text-vx-text-3">for the rest of this upload</span>
      </label>
    </Dialog>
  );
}
