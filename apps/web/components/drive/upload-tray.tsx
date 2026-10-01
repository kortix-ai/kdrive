'use client';

// Upload tray (UNIFY-SPEC §14.2, DESIGN-v2 §6.13): 360 px, r6, float + shadow-4, bottom-right
// of main and 16 px above the strip. A 44 px head on surface-2 "Uploading 3 of 14 files" · a
// 4 px meter with Mono `62% · 18.2 of 29.4 MB · 4.1 MB/s · saves as 1 version` · 40 px rows
// (virtualised, hair-soft dividers) with a 16 px progress ring or an ok check · footer
// "Saved N files as 1 version · Show on timeline". Collapses to a 40 px r4 bar. The queue lives in the store, so it survives navigation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronUp, CircleAlert, RotateCcw, X } from 'lucide-react';
import { basename, formatBytes } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Meter } from '@/components/ui/meter';
import { cx } from '@/components/ui/cx';
import { useVx, type UploadFileState, type UploadJob } from '@/lib/store';
import { fileProgress, fileStatusLabel } from '@/lib/upload/engine';
import { getUploadEngine } from '@/lib/upload/uploads';
import ConflictDialog from './conflict-dialog';
import { MiddleName } from './file-row';
import QuotaDialog from './quota-dialog';
import s from './drive.module.css';

const ROW_H = 40;
const JOB_H = 36;

type TrayRow = { kind: 'job'; job: UploadJob } | { kind: 'file'; job: UploadJob; file: UploadFileState } | { kind: 'dirs'; job: UploadJob; count: number };

function processedBytes(f: UploadFileState): number {
  return fileProgress(f) * f.size;
}

function useSpeed(sent: number, active: boolean): number {
  const samples = useRef<{ t: number; b: number }[]>([]);
  const [speed, setSpeed] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const arr = samples.current;
    arr.push({ t: now, b: sent });
    while (arr.length > 2 && now - arr[0].t > 3000) arr.shift();
    const first = arr[0];
    const dt = (now - first.t) / 1000;
    setSpeed(active && dt > 0.25 ? Math.max(0, (sent - first.b) / dt) : 0);
    if (!active) samples.current = [];
  }, [sent, active]);
  return speed;
}

/** 16 px accent progress ring. */
function Ring({ p, size = 16 }: { p: number; size?: number }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--vx-meter-track)" strokeWidth="2" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--vx-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.02, Math.min(1, p)))}
        className="vx-progress transition-[stroke-dashoffset] duration-[200ms]"
      />
    </svg>
  );
}

/** Ok check for a finished file. */
function DoneDisc() {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-vx-ok" aria-hidden>
      <Check size={16} strokeWidth={2.25} />
    </span>
  );
}

function FileRowView({ file, job }: { file: UploadFileState; job: UploadJob }) {
  const p = fileProgress(file);
  const name = basename(file.path);
  const failed = file.status === 'error';
  const retryable = failed && (job.status === 'error' || job.status === 'cancelled');
  return (
    <div className={cx('flex h-10 items-center gap-3 border-b border-vx-hair-soft px-4', s.rowIn)} title={file.path}>
      <FileIcon name={name} type="file" size={20} />
      {/* Middle-truncated, so the extension and the distinguishing tail ("…-v3-final.txt") survive. */}
      <MiddleName name={name} className="flex-1 text-[14px] font-medium leading-5 text-vx-text-1" />
      <span className={cx('vx-meta max-w-[46%] shrink-0 truncate text-right', failed ? 'text-vx-danger' : file.status === 'conflict' ? 'text-vx-text-1' : 'text-vx-text-3')}>
        {file.status === 'done' ? (file.sent === 0 && file.size > 0 ? 'Already stored' : formatBytes(file.size)) : fileStatusLabel(file, (n) => formatBytes(n))}
      </span>
      {retryable ? (
        <Button size="xs" variant="text" onClick={() => getUploadEngine().retry(job.id)} className="-mr-2">
          Retry
        </Button>
      ) : failed ? (
        <CircleAlert size={16} strokeWidth={1.75} className="shrink-0 text-vx-danger" aria-hidden />
      ) : file.status === 'done' ? (
        <DoneDisc />
      ) : (
        <Ring p={p} />
      )}
    </div>
  );
}

function JobHeader({ job }: { job: UploadJob }) {
  const where = job.basePath === '/' ? 'My Drive' : basename(job.basePath);
  const status =
    job.status === 'active' ? 'In progress' : job.status === 'done' ? 'Saved as one version' : job.status === 'cancelled' ? 'Cancelled' : 'Failed';
  return (
    <div className="flex h-9 items-center gap-2 border-b border-vx-hair-soft px-4 pt-1">
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4 text-vx-text-2">
        {job.files.length} {job.files.length === 1 ? 'file' : 'files'} → {where}
      </span>
      <span className={cx('vx-meta shrink-0', job.status === 'error' ? 'text-vx-danger' : 'text-vx-text-3')}>{status}</span>
      {job.status === 'error' || job.status === 'cancelled' ? (
        <Button size="xs" variant="text" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} onClick={() => getUploadEngine().retry(job.id)} className="-mr-2">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export default function UploadTray() {
  const jobs = useVx((st) => st.uploads);
  const removeUploadJob = useVx((st) => st.removeUploadJob);
  const toggleTimeline = useVx((st) => st.toggleTimeline);
  const pathname = usePathname() ?? '';
  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/');
  const [collapsed, setCollapsed] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const active = jobs.some((j) => j.status === 'active');
  const stats = useMemo(() => {
    let total = 0;
    let processed = 0;
    let sent = 0;
    let files = 0;
    let done = 0;
    let errors = 0;
    for (const j of jobs) {
      for (const f of j.files) {
        files++;
        total += f.size;
        processed += processedBytes(f);
        sent += f.sent;
        if (f.status === 'done') done++;
        if (f.status === 'error') errors++;
      }
    }
    return { total, processed, sent, files, done, errors };
  }, [jobs]);
  const speed = useSpeed(stats.sent, active);
  const ratio = stats.total > 0 ? stats.processed / stats.total : jobs.every((j) => j.status === 'done') ? 1 : 0;
  const versions = jobs.filter((j) => j.status !== 'cancelled').length;

  const rows: TrayRow[] = useMemo(() => {
    const out: TrayRow[] = [];
    const multi = jobs.length > 1;
    for (const j of [...jobs].reverse()) {
      if (multi || j.status === 'error' || j.status === 'cancelled') out.push({ kind: 'job', job: j });
      const dirs = getUploadEngine().info(j.id)?.dirCount ?? 0;
      if (!j.files.length && dirs) out.push({ kind: 'dirs', job: j, count: dirs });
      for (const f of j.files) out.push({ kind: 'file', job: j, file: f });
    }
    return out;
  }, [jobs]);

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: (i) => (rows[i]?.kind === 'job' ? JOB_H : ROW_H), overscan: 8 });

  // Leaving the page mid-upload loses the transfer: ask first.
  useEffect(() => {
    if (!active) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [active]);

  useEffect(() => {
    if (!active) setConfirmCancel(false);
  }, [active]);

  const clearAll = () => {
    for (const j of jobs) {
      getUploadEngine().forget(j.id);
      removeUploadJob(j.id);
    }
    setConfirmCancel(false);
  };

  const lastDone = [...jobs].reverse().find((j) => j.status === 'done');
  // Every unfinished file is paused on "Already exists": nothing moves until the person answers.
  const waiting = active && jobs.some((j) => j.status === 'active' && j.files.some((f) => f.status === 'conflict')) &&
    jobs.every((j) => j.status !== 'active' || j.files.every((f) => f.status === 'conflict' || f.status === 'done'));
  const pct = Math.floor(ratio * 100);
  const title = waiting
    ? 'Waiting for your choice'
    : active
    ? stats.files
      ? `Uploading ${stats.done} of ${stats.files} ${stats.files === 1 ? 'file' : 'files'}`
      : 'Uploading folders'
    : stats.errors
      ? `${stats.errors} ${stats.errors === 1 ? 'upload' : 'uploads'} failed`
      : jobs.every((j) => j.status === 'cancelled')
        ? 'Uploads cancelled'
        : `Uploaded ${stats.done || stats.files} ${(stats.done || stats.files) === 1 ? 'file' : 'files'}`;
  const doneFiles = lastDone ? lastDone.files.length : 0;

  return (
    <>
      <ConflictDialog />
      <QuotaDialog />
      {jobs.length ? (
        <section
          aria-label="Uploads"
          className={cx(
            s.tray,
            onDrive && s.onDrive,
            'dlg-pop fixed z-40 flex w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden bg-vx-float text-vx-text-2 max-[720px]:w-auto',
            collapsed ? 'rounded-vx-sm shadow-vx-3' : 'max-h-[400px] rounded-vx-lg shadow-vx-4',
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex h-10 items-center gap-2.5 rounded-vx-sm pl-3 pr-2.5 text-left transition-colors duration-[120ms] hover:bg-vx-raise"
              aria-label="Expand uploads"
            >
              {active ? <Ring p={ratio} /> : stats.errors ? <CircleAlert size={16} strokeWidth={1.75} className="shrink-0 text-vx-danger" aria-hidden /> : <DoneDisc />}
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-vx-text-1 tabular-nums">
                {waiting ? title : active ? `Uploading ${stats.done} of ${stats.files || versions} · ${pct}%` : title}
              </span>
              <ChevronUp size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-2" aria-hidden />
            </button>
          ) : (
            <>
              <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-vx-hair bg-vx-surface-2 pl-4 pr-2">
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-vx-text-1 tabular-nums" aria-live="polite">
                  {title}
                </span>
                <IconButton size="sm" label="Collapse uploads" onClick={() => setCollapsed(true)}>
                  <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
                </IconButton>
                <IconButton size="sm" label={active ? 'Cancel uploads' : 'Close uploads'} onClick={() => (active ? setConfirmCancel(true) : clearAll())}>
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </IconButton>
              </div>
              {confirmCancel ? (
                <div
                  className="mx-3 mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-vx-md bg-vx-danger-wash px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--vx-danger-edge)]"
                  role="alertdialog"
                  aria-label="Cancel uploads?"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold leading-5 text-vx-text-1">Cancel uploads?</span>
                    <span className="vx-micro block text-vx-text-2">Nothing unfinished is saved.</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="text" onClick={() => setConfirmCancel(false)}>
                      Keep going
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        getUploadEngine().cancelAll();
                        setConfirmCancel(false);
                      }}
                    >
                      Cancel uploads
                    </Button>
                  </span>
                </div>
              ) : null}
              <div className="shrink-0 border-b border-vx-hair-soft px-4 pb-2.5 pt-3">
                <Meter value={waiting ? 0 : ratio} height={4} level={!active && stats.errors ? 'red' : 'ok'} />
                <div className="vx-meta mt-1.5 flex min-w-0 items-center gap-1.5 text-vx-text-3" aria-live="polite">
                  {waiting ? null : (
                    <>
                      <span className="font-medium text-vx-text-1">{pct}%</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span className="truncate">
                    {formatBytes(stats.processed)} of {formatBytes(stats.total)}
                  </span>
                  {active && speed > 0 ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{formatBytes(speed)}/s</span>
                    </>
                  ) : null}
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    saves as {versions} {versions === 1 ? 'version' : 'versions'}
                  </span>
                </div>
              </div>
              <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
                <div className="relative" style={{ height: v.getTotalSize() }}>
                  {v.getVirtualItems().map((vi) => {
                    const r = rows[vi.index];
                    return (
                      <div key={vi.key} className="absolute left-0 top-0 w-full" style={{ height: r.kind === 'job' ? JOB_H : ROW_H, transform: `translateY(${vi.start}px)` }}>
                        {r.kind === 'job' ? (
                          <JobHeader job={r.job} />
                        ) : r.kind === 'dirs' ? (
                          <div className="flex h-10 items-center gap-3 border-b border-vx-hair-soft px-4">
                            <FileIcon name="" type="dir" size={20} />
                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-vx-text-1">
                              {r.count} empty {r.count === 1 ? 'folder' : 'folders'}
                            </span>
                            {r.job.status === 'done' ? (
                              <DoneDisc />
                            ) : (
                              <span className="vx-meta text-vx-text-3">{r.job.status === 'active' ? 'Saving version' : r.job.status === 'cancelled' ? 'Cancelled' : 'Failed'}</span>
                            )}
                          </div>
                        ) : (
                          <FileRowView file={r.file} job={r.job} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {lastDone && !active ? (
                <div className="flex shrink-0 items-center gap-1 border-t border-vx-hair py-1.5 pl-4 pr-2 text-[12px] leading-4 text-vx-text-3">
                  {/* Wraps to a second line rather than cutting the sentence off. */}
                  <span className="line-clamp-2 min-w-0 flex-1">
                    Saved {doneFiles ? `${doneFiles} ${doneFiles === 1 ? 'file' : 'files'}` : 'a folder'} as 1 version
                    {lastDone.basePath !== '/' ? ` in ${basename(lastDone.basePath)}` : ''}
                  </span>
                  <Button size="xs" variant="text" onClick={() => toggleTimeline(true)} className="shrink-0">
                    Show on timeline
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
