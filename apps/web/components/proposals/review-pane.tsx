'use client';

// The compare pane of a proposal review (MCP.md §14.7): "Now" (A) against "Proposed" (B)
// with the existing compare views, picked by `compare.kind`; moves and copies show a facts
// card, folders one line. Pending rows get "Discard this file" / "Accept this file".
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, FolderPlus } from 'lucide-react';
import { basename, dirname, formatBytes, TEXT_DIFF_MAX_BYTES, type ProposalFile } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { Segmented } from '@/components/ui/segmented';
import { CompareCsv } from '@/components/versioning/compare-csv';
import { MissingSide, SideDisc, SummaryBar, type CompareModes } from '@/components/versioning/compare-header';
import { CompareImage } from '@/components/versioning/compare-image';
import { CompareMeta } from '@/components/versioning/compare-meta';
import { CompareText } from '@/components/versioning/compare-text';
import { driveHref } from '@/lib/urls';
import { CHANGE_LABEL } from './format';

export type ReviewView = 'text' | 'image' | 'csv' | 'meta' | 'removed' | 'move' | 'folder' | 'none';

/** Which view a proposed change is reviewed in. */
export function reviewView(f: ProposalFile): ReviewView {
  if (f.op === 'mkdir') return 'folder';
  if (f.op === 'move' || f.op === 'copy') return 'move';
  if (f.op === 'delete') return 'removed';
  const c = f.compare;
  if (!c) return 'none';
  if (c.tooLargeForDiff || c.kind === 'binary') return 'meta';
  return c.kind;
}

/** A drive link that opens the file's preview (`?file=`), or the folder itself. */
export function fileLink(path: string, isDir = false): string {
  if (isDir) return driveHref(path);
  const folder = driveHref(dirname(path) || '/');
  return `${folder}?file=${encodeURIComponent(basename(path))}`;
}

function MoveFacts({ f }: { f: ProposalFile }) {
  const verb = f.op === 'move' ? 'Moves' : 'Copies';
  const from = f.fromPath ?? '';
  return (
    <div className="p-5 max-[720px]:p-4">
      <div className="max-w-[560px] rounded-vx-md bg-vx-surface-2 p-4">
        <p className="text-[16px] font-semibold leading-6 text-vx-text-1">
          {verb} {f.entryType === 'dir' ? 'a folder' : 'a file'}
        </p>
        <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[14px] leading-5">
          <dt className="text-vx-text-3">From</dt>
          <dd className="min-w-0">
            <Link href={fileLink(from, f.entryType === 'dir')} className="vx-code break-all text-vx-accent hover:underline">
              {from}
            </Link>
          </dd>
          <dt className="text-vx-text-3">To</dt>
          <dd className="vx-code flex min-w-0 items-center gap-1.5 break-all text-vx-text-1">
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-3" />
            {f.path}
          </dd>
          <dt className="text-vx-text-3">Size</dt>
          <dd className="tabular-nums text-vx-text-2">{f.size !== null ? formatBytes(f.size) : f.baseSize !== null ? formatBytes(f.baseSize) : '—'}</dd>
        </dl>
        <p className="vx-meta mt-3 text-vx-text-3">
          {f.op === 'move' ? 'The original goes away when you accept.' : 'The original stays where it is.'}{' '}
          <Link href={driveHref(dirname(f.path) || '/')} className="text-vx-accent hover:underline">
            Open the destination folder
          </Link>
        </p>
      </div>
    </div>
  );
}

export function ReviewPane({
  file,
  onAccept,
  onDiscard,
  busy,
  phone,
}: {
  file: ProposalFile | null;
  onAccept?: (seq: number) => void;
  onDiscard?: (seq: number) => void;
  /** An accept or discard is running (disables the footer). */
  busy?: boolean;
  /** Phones force the unified text diff. */
  phone?: boolean;
}) {
  const [modes, setModes] = useState<CompareModes>({ text: 'split', image: 'side', changesOnly: false });
  if (!file) return <EmptyState className="h-full" title="Pick a file to review." body="Choose a change on the left to see what the agent suggests." />;

  const view = reviewView(file);
  const a = file.compare?.a ?? null;
  const b = file.compare?.b ?? null;
  const name = basename(file.path) || file.path;
  const pending = file.status === 'pending';

  let body: React.ReactNode;
  switch (view) {
    case 'text':
      body = <CompareText a={a} b={b} path={file.path} mode={phone ? 'unified' : modes.text} />;
      break;
    case 'image':
      body = <CompareImage a={a} b={b} mode={modes.image} />;
      break;
    case 'csv':
      body = <CompareCsv a={a} b={b} path={file.path} changesOnly={modes.changesOnly} />;
      break;
    case 'meta':
      body = (
        <div className="min-h-0 flex-1 overflow-auto">
          <CompareMeta
            a={a}
            b={b}
            note={file.compare?.tooLargeForDiff ? `Files over ${formatBytes(TEXT_DIFF_MAX_BYTES)} are compared by facts only.` : undefined}
          />
        </div>
      );
      break;
    case 'removed':
      body = (
        <div className="min-h-0 flex-1 overflow-auto">
          <SummaryBar>
            <span className="truncate">The agent suggests deleting this {file.entryType === 'dir' ? 'folder and everything in it' : 'file'}.</span>
          </SummaryBar>
          <div className="grid grid-cols-2 gap-4 p-5 max-[720px]:grid-cols-1 max-[720px]:p-4">
            {a ? <CompareMeta a={a} b={null} /> : <p className="vx-body text-vx-text-3">{file.path}</p>}
            <MissingSide which="B" />
          </div>
        </div>
      );
      break;
    case 'move':
      body = (
        <div className="min-h-0 flex-1 overflow-auto">
          <MoveFacts f={file} />
        </div>
      );
      break;
    case 'folder':
      body = (
        <div className="flex items-center gap-3 p-5 max-[720px]:p-4">
          <FolderPlus size={20} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-2" />
          <p className="vx-body text-vx-text-1">
            Creates the folder <span className="vx-code break-all">{file.path}</span>
          </p>
        </div>
      );
      break;
    default:
      body = pending ? (
        <EmptyState className="flex-1" title="Nothing to compare." body="This change has no content to show." />
      ) : (
        <EmptyState
          className="flex-1"
          title="This change is decided."
          body="Suggested content is kept only while a proposal waits for review. Open the file in your drive to see it now."
        />
      );
  }

  const modeControl =
    view === 'text' ? (
      <Segmented
        label="Diff layout"
        size="sm"
        className="max-[720px]:hidden"
        value={modes.text}
        onChange={(v) => setModes({ ...modes, text: v })}
        options={[
          { value: 'split', label: 'Split' },
          { value: 'unified', label: 'Unified' },
        ]}
      />
    ) : view === 'image' ? (
      <Segmented
        label="Image compare mode"
        size="sm"
        value={modes.image}
        onChange={(v) => setModes({ ...modes, image: v })}
        options={[
          { value: 'side', label: 'Side' },
          { value: 'swipe', label: 'Swipe', disabled: !a || !b },
        ]}
      />
    ) : view === 'csv' ? (
      <Segmented
        label="Rows shown"
        size="sm"
        value={modes.changesOnly ? 'changes' : 'all'}
        onChange={(v) => setModes({ ...modes, changesOnly: v === 'changes' })}
        options={[
          { value: 'all', label: 'All rows' },
          { value: 'changes', label: 'Changes only' },
        ]}
      />
    ) : null;

  return (
    <section aria-label={`Review ${file.path}`} data-view={view} className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-vx-hair px-5 py-2 max-[720px]:px-4">
        <FileIcon name={name} type={file.entryType === 'dir' ? 'dir' : 'file'} size={24} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold leading-5 text-vx-text-1" title={file.path}>
            {name}
          </span>
          <span className="vx-meta truncate text-vx-text-3">
            {CHANGE_LABEL[file.change]} · {file.path}
          </span>
        </div>
        {view === 'text' || view === 'image' || view === 'csv' || view === 'meta' ? (
          <span className="flex shrink-0 items-center gap-3 text-[13px] leading-5 text-vx-text-2">
            <span className="inline-flex items-center gap-1.5">
              <SideDisc which="A" /> Now
            </span>
            <span className="inline-flex items-center gap-1.5">
              <SideDisc which="B" /> Proposed
            </span>
          </span>
        ) : null}
        {modeControl}
        {b ? (
          <a
            href={b.downloadUrl}
            download
            aria-label="Download the proposed file"
            title="Download the proposed file"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-vx-text-2 transition-colors duration-[120ms] hover:bg-vx-surface-3 hover:text-vx-text-1"
          >
            <Download size={18} strokeWidth={1.75} aria-hidden />
          </a>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      {pending && (onAccept || onDiscard) ? (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-vx-hair px-5 py-3 max-[720px]:px-4">
          {onDiscard ? (
            <Button variant="text" disabled={busy} onClick={() => onDiscard(file.seq)}>
              Discard this file
            </Button>
          ) : null}
          {onAccept ? (
            <Button variant="outline" disabled={busy} onClick={() => onAccept(file.seq)}>
              Accept this file
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

export default ReviewPane;
