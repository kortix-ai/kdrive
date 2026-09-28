'use client';

// Teaching empty states for the drive (DESIGN §6.11 copy, DESIGN-v2 §5 / §6.18 look): a flat
// 120 px illustration, an 18/600 title, one line of text-3 and at most one action. Past or
// missing things use the amber / dashed variant of the illustration.
import { RETENTION_COPY } from '@volumes/shared';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';

type Art = 'stack' | 'slab' | 'stencil' | 'search';

/** Drive-flavoured EmptyState: `stencil` (missing / past) uses the past illustration. */
export function DriveEmpty({
  art,
  title,
  body,
  actions,
  className,
}: {
  art: Art;
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return <EmptyState tone={art === 'stencil' ? 'past' : 'default'} title={title} body={body} actions={actions} className={className} />;
}

export type EmptyKind =
  | { kind: 'drive' }
  | { kind: 'folder' }
  | { kind: 'past-missing'; when: string }
  | { kind: 'past-empty'; when: string }
  | { kind: 'version-gone' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export default function EmptyDrive({
  state,
  onUpload,
  onNewFolder,
  onBackToNow,
  onGoHome,
  onRetry,
}: {
  state: EmptyKind;
  onUpload?: () => void;
  onNewFolder?: () => void;
  onBackToNow?: () => void;
  onGoHome?: () => void;
  onRetry?: () => void;
}) {
  const backToNow = (
    <Button variant="primary" onClick={onBackToNow} kbd="Esc">
      Back to now
    </Button>
  );
  switch (state.kind) {
    case 'drive':
      return (
        <DriveEmpty
          art="stack"
          title="Drop files or folders here."
          body="Every drop becomes a version you can come back to. The strip below records each one."
          actions={
            <>
              <Button variant="primary" onClick={onUpload} kbd="U" icon={<Upload size={18} strokeWidth={1.75} aria-hidden />}>
                Upload
              </Button>
              <p className="vx-micro basis-full text-vx-text-3">
                or press{' '}
                <button type="button" onClick={onNewFolder} className="rounded-vx-xs align-middle hover:text-vx-text-1">
                  <Kbd>N</Kbd>
                </button>{' '}
                for a new folder
              </p>
            </>
          }
        />
      );
    case 'folder':
      return (
        <DriveEmpty
          art="slab"
          title="Nothing in here yet."
          body={
            <>
              Drag files in, or press <Kbd>U</Kbd>.
            </>
          }
        />
      );
    case 'past-missing':
      return <DriveEmpty art="stencil" title={`This folder did not exist on ${state.when}.`} actions={backToNow} />;
    case 'past-empty':
      return <DriveEmpty art="stencil" title={`This folder was empty on ${state.when}.`} actions={backToNow} />;
    case 'version-gone':
      return <DriveEmpty art="stencil" title="This version is no longer kept." body={RETENTION_COPY} actions={backToNow} />;
    case 'missing':
      return (
        <DriveEmpty
          art="stencil"
          title="This folder doesn't exist."
          body="It may have been moved or deleted. Recently deleted keeps items while their history is kept."
          actions={
            <Button variant="outline" onClick={onGoHome}>
              Go to My Drive
            </Button>
          }
        />
      );
    case 'error':
      return (
        <DriveEmpty
          art="stencil"
          title="Couldn't load this folder."
          body={state.message}
          actions={
            <Button variant="outline" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      );
  }
}
