'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addMinutes,
  addMonths,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  setHours,
  setMinutes,
  startOfDay,
  startOfMinute,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './icon-button';

/** Minutes between time slots. */
export const SLOT_MINUTES = 30;
const WEEK = { weekStartsOn: 1 } as const;

/** The first slot at or after `d` ("10:02" → "10:30"). */
export function roundUpToSlot(d: Date, step = SLOT_MINUTES): Date {
  const m = startOfMinute(d);
  const over = m.getMinutes() % step;
  return over === 0 && m.getTime() === d.getTime() ? m : addMinutes(m, step - over);
}

/** The 42 days (6 weeks, Monday first) shown for the month holding `month`. */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month), WEEK);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** `day` at the time of day of `time`. */
function withTime(day: Date, time: Date): Date {
  return setMinutes(setHours(startOfDay(day), time.getHours()), time.getMinutes());
}

/** The earliest valid moment on `day` (a slot after `min`), or null when the whole day is before `min`. */
function firstValidOn(day: Date, min: Date): Date | null {
  const start = startOfDay(day);
  const first = isBefore(start, min) ? roundUpToSlot(addMinutes(min, 1)) : start;
  return isSameDay(first, day) ? first : null;
}

/**
 * Date and time picker (inline panel): a Monday-first month grid and a column of
 * 30-minute slots, 24-hour clock. Days and slots before `min` are disabled. Arrow
 * keys move the day (± 1 / ± 7), PageUp/PageDown the month.
 */
export function DateTimePicker({
  value,
  onChange,
  min,
  label,
  className,
}: {
  value: Date;
  onChange: (d: Date) => void;
  /** Nothing at or before this moment can be picked. */
  min?: Date;
  /** Accessible name for the whole picker. */
  label: string;
  className?: string;
}) {
  const [view, setView] = useState(() => startOfMonth(value));
  const days = useMemo(() => monthGrid(view), [view]);
  const gridRef = useRef<HTMLDivElement>(null);
  const timesRef = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);
  const today = new Date();
  const minDay = min ? startOfDay(min) : null;

  // Follow the value when it moves to another month (keyboard, or the caller).
  useEffect(() => {
    setView((v) => (isSameMonth(v, value) ? v : startOfMonth(value)));
  }, [value]);

  // Keyboard moves keep focus on the selected day after the grid re-renders.
  useEffect(() => {
    if (!focusDay.current) return;
    focusDay.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[data-selected=true]')?.focus();
  });

  // Keep the chosen slot in view inside its own column (never scroll the page or dialog).
  useLayoutEffect(() => {
    const list = timesRef.current;
    const on = list?.querySelector<HTMLElement>('[aria-pressed=true]');
    if (!list || !on) return;
    if (on.offsetTop < list.scrollTop || on.offsetTop + on.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = on.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
    }
  }, [value]);

  const dayDisabled = (d: Date) => !!minDay && isBefore(d, minDay);

  const pickDay = (d: Date) => {
    if (dayDisabled(d)) return;
    const next = withTime(d, value);
    onChange(min && !isBefore(min, next) ? (firstValidOn(d, min) ?? next) : next);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(value, -1),
      ArrowRight: () => addDays(value, 1),
      ArrowUp: () => addDays(value, -7),
      ArrowDown: () => addDays(value, 7),
      PageUp: () => addMonths(value, -1),
      PageDown: () => addMonths(value, 1),
    };
    const move = step[e.key];
    if (!move) return;
    e.preventDefault();
    const d = move();
    if (dayDisabled(d)) return;
    focusDay.current = true;
    pickDay(d);
  };

  const slots = useMemo(() => {
    const start = startOfDay(value);
    return Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => addMinutes(start, i * SLOT_MINUTES));
  }, [value]);

  const canGoBack = !minDay || isBefore(startOfMonth(minDay), view);

  return (
    <div
      role="group"
      aria-label={label}
      className={cx('flex gap-3 rounded-vx-md border border-vx-hair bg-vx-surface-2 p-3 max-[520px]:flex-col', className)}
    >
      <div className="w-[238px] shrink-0">
        <div className="mb-1 flex h-8 items-center justify-between">
          <span className="vx-ui pl-1 text-vx-text-1" aria-live="polite">
            {format(view, 'MMMM yyyy')}
          </span>
          <span className="flex items-center gap-0.5">
            <IconButton size="sm" label="Previous month" disabled={!canGoBack} onClick={() => setView((v) => addMonths(v, -1))}>
              <ChevronLeft size={16} strokeWidth={1.75} />
            </IconButton>
            <IconButton size="sm" label="Next month" onClick={() => setView((v) => addMonths(v, 1))}>
              <ChevronRight size={16} strokeWidth={1.75} />
            </IconButton>
          </span>
        </div>
        <div className="grid grid-cols-7" aria-hidden>
          {days.slice(0, 7).map((d) => (
            <span key={d.getDay()} className="vx-colhead flex h-7 items-center justify-center">
              {format(d, 'EEEEEE')}
            </span>
          ))}
        </div>
        <div ref={gridRef} className="grid grid-cols-7 gap-y-0.5" onKeyDown={onGridKey}>
          {days.map((d) => {
            const selected = isSameDay(d, value);
            const isToday = isSameDay(d, today);
            const outside = !isSameMonth(d, view);
            const disabled = dayDisabled(d);
            return (
              <button
                key={d.getTime()}
                type="button"
                data-selected={selected}
                tabIndex={selected ? 0 : -1}
                disabled={disabled}
                aria-pressed={selected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={format(d, 'EEEE d MMMM yyyy')}
                onClick={() => pickDay(d)}
                className={cx(
                  'vx-inset-focus mx-auto flex h-8 w-8 items-center justify-center rounded-vx-sm font-mono text-[12.5px] tabular-nums transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
                  selected
                    ? 'bg-vx-primary font-semibold text-vx-on-primary'
                    : cx(
                        outside ? 'text-vx-text-3' : 'text-vx-text-1',
                        isToday && 'shadow-[inset_0_0_0_1px_var(--vx-hair-strong)]',
                        'enabled:hover:bg-vx-raise',
                      ),
                )}
              >
                {format(d, 'd')}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-l border-vx-hair pl-3 max-[520px]:border-l-0 max-[520px]:border-t max-[520px]:pl-0 max-[520px]:pt-3">
        <span className="vx-colhead flex h-8 items-center pl-1">Time</span>
        <div
          ref={timesRef}
          role="group"
          aria-label="Time"
          className="relative h-[230px] overflow-y-auto pr-1 max-[520px]:h-[132px]"
        >
          {slots.map((s) => {
            const on = s.getHours() === value.getHours() && s.getMinutes() === value.getMinutes();
            const disabled = !!min && !isBefore(min, s);
            return (
              <button
                key={s.getTime()}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange(s)}
                className={cx(
                  'vx-inset-focus flex h-8 w-full items-center rounded-vx-sm px-2.5 font-mono text-[12.5px] tabular-nums transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
                  on ? 'bg-vx-primary font-semibold text-vx-on-primary' : 'text-vx-text-1 enabled:hover:bg-vx-hover',
                )}
              >
                {format(s, 'HH:mm')}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default DateTimePicker;
