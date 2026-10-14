'use client';

import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/kbd';

const GROUPS: { label: string; keys: [string, string][] }[] = [
  { label: 'Global', keys: [['/  ⌘K', 'Search'], ['?', 'Keyboard shortcuts'], ['h', 'History'], ['⌘B', 'Collapse / expand sidebar'], ['⌘Z', 'Undo last action'], ['g d', 'Go to files'], ['g c', 'Go to checkpoints'], ['g x', 'Go to recently deleted'], ['g p', 'Go to proposals'], ['g ,', 'Go to settings']] },
  { label: 'Drive', keys: [['u  ⇧U', 'Upload files / folder'], ['n', 'New folder'], ['↵', 'Open'], ['Space', 'Preview'], ['F2', 'Rename'], ['⌫', 'Delete'], ['d', 'Download'], ['m  ⇧M', 'Move / copy to…'], ['s', 'Share'], ['⇧H', 'Versions'], ['v', 'List / grid'], ['⌘A', 'Select all']] },
  { label: 'Time', keys: [[',  .', 'Older / newer version'], ['p', 'New checkpoint'], ['c', 'Compare'], ['r', 'Restore (in the past)'], ['Esc', 'Back to now']] },
  { label: 'Preview', keys: [['←  →', 'Previous / next file'], ['+  −', 'Zoom'], ['0  1', 'Fit / 100 %'], ['Esc', 'Close']] },
  { label: 'Compare', keys: [[']  [', 'Next / previous change'], ['x', 'Swap A and B'], ['←  →', 'Move the swipe'], ['⇧←  ⇧→', 'Move the swipe ×10'], ['Esc', 'Back']] },
];

/** A chord like "g d" shows as `g` then `d`; alternatives are separated by two spaces. */
function Keys({ k }: { k: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {k.split('  ').map((alt, i) => (
        <span key={alt} className="flex items-center gap-1">
          {i > 0 ? <span className="vx-micro text-vx-text-3">or</span> : null}
          {alt.includes(' ') && alt.length <= 4 ? (
            alt.split(' ').map((part, j) => (
              <span key={part + j} className="flex items-center gap-1">
                {j > 0 ? <span className="vx-micro text-vx-text-3">then</span> : null}
                <Kbd>{part}</Kbd>
              </span>
            ))
          ) : (
            <Kbd>{alt}</Kbd>
          )}
        </span>
      ))}
    </span>
  );
}

const LEFT = new Set(['Global', 'Time', 'Compare']);
const COLUMNS = [GROUPS.filter((g) => LEFT.has(g.label)), GROUPS.filter((g) => !LEFT.has(g.label))];

/** The shortcut groups in two balanced stacks (Global · Time · Compare | Drive · Preview), so short groups leave no
 *  holes; one column on phones. Used by the sheet and inline in Settings. */
export function ShortcutList({ className }: { className?: string }) {
  return (
    <div className={cx('grid grid-cols-2 items-start gap-x-8 gap-y-5 max-[720px]:grid-cols-1', className)}>
      {COLUMNS.map((col, i) => (
        <div key={i} className="flex flex-col gap-5">
          {col.map((g) => (
            <section key={g.label}>
              <h3 className="vx-eyebrow mb-1.5">{g.label}</h3>
              <ul>
                {g.keys.map(([k, label]) => (
                  <li key={k + label} className="flex min-h-[30px] items-center justify-between gap-3">
                    <span className="min-w-0 text-[14px] leading-5 text-vx-text-1">{label}</span>
                    <Keys k={k} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Keyboard shortcuts (UNIFY-SPEC §14.1): a 640 dialog; group titles as eyebrows, 30 px rows, Mono kbd. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width={640}>
      <ShortcutList className="pb-4" />
    </Dialog>
  );
}

export default ShortcutSheet;
