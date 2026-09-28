'use client';

// Upload tray (DESIGN §6.12): 380 px, bottom-right above the Time Strip.
// Header · aggregate bar (40 cells, %, bytes, speed) · per-file rows (virtualised)
// · footer "Uploaded N files as one version · Show on timeline". Collapses to a
// 32 px bar. The queue lives in the app store, so it survives navigation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { basename, formatBytes } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { useVx, type UploadFileState, type UploadJob } from '@/lib/store';
import { fileProgress, fileStatusLabel } from '@/lib/upload/engine';
import { getUploadEngine } from '@/lib/upload/uploads';
import ConflictDialog from './conflict-dialog';
import QuotaDialog from './quota-dialog';
import s from './drive.module.css';

const CELLS = 40;
const ROW_H = 36;

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

function Cells({ ratio, tone }: { ratio: number; tone: 'ok' | 'done' | 'error' }) {
  const on = Math.round(Math.max(0, Math.min(1, ratio)) * CELLS);
  const color = tone === 'error' ? 'var(--vx-danger)' : tone === 'done' ? 'var(--vx-ok)' : 'var(--vx-text-2)';
  return (
    <div className="flex h-[3px] gap-px" aria-hidden>
      {Array.from({ length: CELLS }, (_, i) => (
        <span key={i} className="flex-1" style={{ background: i < on ? color : 'var(--vx-hair)' }} />
      ))}
    </div>
  );
}

function FileRowView({ file, job }: { file: UploadFileState; job: UploadJob }) {
  const p = fileProgress(file);
  const name = basename(file.path);
  const tone = file.status === 'error' ? 'text-vx-danger' : file.status === 'done' ? 'text-vx-text-3' : file.status === 'conflict' ? 'text-vx-text-1' : 'text-vx-text-3';
  return (
    <div className={cx('relative flex h-9 items-center gap-2.5 px-3', s.rowIn)} title={file.path}>
      <FileIcon name={name} type="file" />
      <span className="vx-name min-w-0 flex-1 truncate text-vx-text-1">{name}</span>
      <span className={cx('vx-meta max-w-[48%] shrink-0 truncate text-right', tone)}>
        {fileStatusLabel(file, (n) => formatBytes(n))}
      </span>
      {file.status === 'error' && (job.status === 'error' || job.status === 'cancelled') ? (
        <button type="button" onClick={() => getUploadEngine().retry(job.id)} className="vx-ui shrink-0 px-1 text-vx-text-2 hover:text-vx-text-1">
          Retry
        </button>
      ) : null}
      <span className="absolute bottom-0 left-3 right-3 h-px bg-vx-hair-soft" aria-hidden>
        <span
          className="block h-full transition-[width] duration-[120ms]"
          style={{ width: `${Math.round(p * 100)}%`, background: file.status === 'done' ? 'var(--vx-ok)' : file.status === 'error' ? 'var(--vx-danger)' : 'var(--vx-text-3)' }}
        />
      </span>
    </div>
  );
}

function JobHeader({ job }: { job: UploadJob }) {
  const where = job.basePath === '/' ? 'My Drive' : basename(job.basePath);
  const status =
    job.status === 'active' ? 'in progress' : job.status === 'done' ? 'saved as one version' : job.status === 'cancelled' ? 'cancelled' : 'failed';
  return (
    <div className="flex h-9 items-center gap-2 border-t border-vx-hair px-3 first:border-t-0">
      <span className="vx-label min-w-0 flex-1 truncate">
        {job.files.length} {job.files.length === 1 ? 'file' : 'files'} → {where}/
      </span>
      <span className={cx('vx-meta', job.status === 'error' ? 'text-vx-danger' : 'text-vx-text-4')}>{status}</span>
      {job.status === 'error' || job.status === 'cancelled' ? (
        <button type="button" onClick={() => getUploadEngine().retry(job.id)} className="vx-ui inline-flex items-center gap-1 px-1 text-vx-text-2 hover:text-vx-text-1">
          <RotateCcw size={12} aria-hidden /> Retry
        </button>
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

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 8 });

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
  const bottom = onDrive ? 'calc(var(--vx-strip-h) + 12px)' : '16px';
  const pct = Math.floor(ratio * 100);
  const tone: 'ok' | 'done' | 'error' = !active && stats.errors ? 'error' : !active && ratio >= 1 ? 'done' : 'ok';

  return (
    <>
      <ConflictDialog />
      <QuotaDialog />
      {jobs.length ? (
        <section
          aria-label="Uploads"
          className="dlg-pop fixed right-4 z-40 flex w-[380px] max-w-[calc(100vw-32px)] flex-col border border-vx-hair-strong bg-vx-float shadow-[0_12px_32px_-12px_rgba(0,0,0,.6)]"
          style={{ bottom }}
        >
          {collapsed ? (
            <button type="button" onClick={() => setCollapsed(false)} className="flex h-8 items-center gap-2 px-3 text-left" aria-label="Expand uploads">
              <span className="vx-meta flex-1 text-vx-text-2">
                ↑ {stats.done} of {stats.files || versions} <span className="vx-unit">·</span> {pct} %
              </span>
              <span className="w-24">
                <Cells ratio={ratio} tone={tone} />
              </span>
              <ChevronUp size={14} className="text-vx-text-3" aria-hidden />
            </button>
          ) : (
            <>
              <div className="flex h-9 items-center gap-1 border-b border-vx-hair pl-3 pr-1.5">
                <span className="vx-label min-w-0 flex-1 truncate">
                  Uploads · {stats.files} {stats.files === 1 ? 'file' : 'files'} · {versions} {versions === 1 ? 'version' : 'versions'}
                </span>
                <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse uploads" className="inline-flex h-6 w-6 items-center justify-center text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1">
                  <ChevronDown size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => (active ? setConfirmCancel(true) : clearAll())}
                  aria-label={active ? 'Cancel uploads' : 'Close uploads'}
                  title={active ? 'Cancel uploads' : 'Close'}
                  className="inline-flex h-6 w-6 items-center justify-center text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              {confirmCancel ? (
                <div className="flex items-center gap-2 border-b border-vx-hair px-3 py-2" role="alertdialog" aria-label="Cancel uploads?">
                  <span className="vx-meta flex-1 text-vx-text-2">Cancel uploads? Nothing unfinished is saved.</span>
                  <button type="button" onClick={() => setConfirmCancel(false)} className="vx-ui px-1.5 text-vx-text-2 hover:text-vx-text-1">
                    Keep going
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      getUploadEngine().cancelAll();
                      setConfirmCancel(false);
                    }}
                    className="vx-ui px-1.5 text-vx-danger hover:bg-vx-danger-wash"
                  >
                    Cancel uploads
                  </button>
                </div>
              ) : null}
              <div className="px-3 pb-2 pt-2.5">
                <Cells ratio={ratio} tone={tone} />
                <div className="vx-meta mt-1.5 flex items-center gap-1.5 text-vx-text-3" aria-live="polite">
                  <span className="text-vx-text-1">{pct} %</span>
                  <span className="vx-unit">·</span>
                  <span>
                    {formatBytes(stats.processed)} <span className="vx-unit">/ {formatBytes(stats.total)}</span>
                  </span>
                  {active && speed > 0 ? (
                    <>
                      <span className="vx-unit">·</span>
                      <span>{formatBytes(speed)}/s</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div ref={scroller} className="max-h-[252px] overflow-auto border-t border-vx-hair">
                <div className="relative" style={{ height: v.getTotalSize() }}>
                  {v.getVirtualItems().map((vi) => {
                    const r = rows[vi.index];
                    return (
                      <div key={vi.key} className="absolute left-0 top-0 w-full" style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}>
                        {r.kind === 'job' ? (
                          <JobHeader job={r.job} />
                        ) : r.kind === 'dirs' ? (
                          <div className="flex h-9 items-center gap-2.5 px-3">
                            <FileIcon name="" type="dir" />
                            <span className="vx-name flex-1 text-vx-text-1">
                              {r.count} empty {r.count === 1 ? 'folder' : 'folders'}
                            </span>
                            <span className="vx-meta text-vx-text-3">{r.job.status === 'done' ? '✓' : r.job.status === 'active' ? 'saving version' : r.job.status}</span>
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
                <div className="vx-meta flex h-9 items-center gap-1.5 border-t border-vx-hair px-3 text-vx-text-2">
                  <span className="text-vx-ok" aria-hidden>
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Uploaded {lastDone.files.length || 'a folder'}
                    {lastDone.files.length ? (lastDone.files.length === 1 ? ' file' : ' files') : ''} as one version
                    {lastDone.basePath !== '/' ? ` to ${basename(lastDone.basePath)}` : ''}
                  </span>
                  <button type="button" onClick={() => toggleTimeline(true)} className="vx-ui shrink-0 text-vx-text-1 underline-offset-2 hover:underline">
                    Show on timeline
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}

