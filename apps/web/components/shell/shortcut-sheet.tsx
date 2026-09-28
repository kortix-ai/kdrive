'use client';

import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

const GROUPS: { label: string; keys: [string, string][] }[] = [
  { label: 'Global', keys: [['/  ⌘K', 'Search'], ['?', 'Keyboard shortcuts'], ['h', 'Timeline'], ['⌘Z', 'Undo last action'], ['g d', 'Go to drive'], ['g c', 'Go to checkpoints'], ['g x', 'Go to recently deleted'], ['g ,', 'Go to settings']] },
  { label: 'Drive', keys: [['u  ⇧U', 'Upload files / folder'], ['n', 'New folder'], ['↵', 'Open'], ['Space', 'Preview'], ['F2', 'Rename'], ['⌫', 'Delete'], ['d', 'Download'], ['m  ⇧M', 'Move / copy to…'], ['s', 'Share'], ['⇧H', 'Versions'], ['v', 'List / grid'], ['⌘A', 'Select all']] },
  { label: 'Time', keys: [[',  .', 'Older / newer version'], ['p', 'New checkpoint'], ['c', 'Compare'], ['r', 'Restore (in the past)'], ['Esc', 'Back to now']] },
  { label: 'Preview', keys: [['←  →', 'Previous / next file'], ['Esc', 'Close']] },
];

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard" width={560}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {GROUPS.map((g) => (
          <section key={g.label}>
            <div className="vx-label mb-2">{g.label}</div>
            <ul className="space-y-1.5">
              {g.keys.map(([k, label]) => (
                <li key={k + label} className="flex items-center justify-between gap-3">
                  <span className="vx-ui text-vx-text-2">{label}</span>
                  <span className="flex gap-1">
                    {k.split('  ').map((part) => (
                      <Kbd key={part}>{part}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export default ShortcutSheet;
