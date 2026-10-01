'use client';

// "Changed since the agent read them" (MCP.md §14.7): an inline confirm in the danger variant.
// "Show them" filters the file list to the conflicting rows; "Accept anyway" asks once more
// (it turns into a danger "Replace newer changes" for 4 s) before accepting with force.
import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';

/** How long "Replace newer changes" waits for the second click. */
export const ARM_MS = 4000;

export function ConflictBar({
  count,
  onShow,
  onAcceptAnyway,
  busy,
  showing,
  nudge,
  className,
}: {
  count: number;
  onShow: () => void;
  onAcceptAnyway: () => void;
  busy?: boolean;
  /** The list is filtered to the conflicts (the button then reads "Show all"). */
  showing?: boolean;
  /** Bumped when an accept is refused again while the bar is showing: it nudges and takes focus. */
  nudge?: number;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [nudging, setNudging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const seen = useRef(nudge);

  useEffect(() => {
    if (nudge === seen.current) return;
    seen.current = nudge;
    bar.current?.focus();
    setNudging(true);
    const t = setTimeout(() => setNudging(false), 400);
    return () => clearTimeout(t);
  }, [nudge]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const arm = () => {
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), ARM_MS);
  };
  const confirm = () => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onAcceptAnyway();
  };

  const files = count === 1 ? '1 file' : `${count.toLocaleString('en-US')} files`;
  return (
    <div
      ref={bar}
      role="alert"
      tabIndex={-1}
      data-conflict-bar=""
      data-nudge={nudging ? '' : undefined}
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-vx-md bg-vx-danger-wash px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--vx-danger-edge)] outline-none',
        nudging && 'vx-nudge',
        className,
      )}
    >
      <TriangleAlert size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-danger" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-semibold leading-5 text-vx-text-1">
          {files} changed since the agent read {count === 1 ? 'it' : 'them'}.
        </span>
        <span className="text-[13px] leading-5 text-vx-text-2">Accepting replaces those changes. Review them first.</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-[720px]:w-full max-[720px]:justify-end">
        <Button variant="text" size="sm" onClick={onShow}>
          {showing ? 'Show all' : 'Show them'}
        </Button>
        {armed ? (
          <Button variant="danger" size="sm" loading={busy} onClick={confirm} autoFocus>
            Replace newer changes
          </Button>
        ) : (
          <Button variant="outline" size="sm" loading={busy} onClick={arm}>
            Accept anyway
          </Button>
        )}
      </div>
    </div>
  );
}

export default ConflictBar;
