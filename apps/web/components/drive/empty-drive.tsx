'use client';

// Teaching empty states for the drive (DESIGN §6.11 copy, UNIFY-SPEC §9 / §14.2 look): a static
// 120 px isometric voxel piece, a 16/600 title, one line of text-3 and at most one action. Past
// things (did not exist / was empty / no longer kept) use the `gone` piece in the past tone.
import { RETENTION_COPY } from '@volumes/shared';
import { FolderPlus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, type EmptyArtKey } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';

type Art = 'stack' | 'slab' | 'stencil' | 'missing' | 'search';

/** Drive art → shared iso piece (UNIFY-SPEC §9). */
const ART: Record<Art, EmptyArtKey> = { stack: 'drive', slab: 'folder', stencil: 'gone', missing: 'gone', search: 'search' };

/** Drive-flavoured EmptyState: `stencil` (past) is the `gone` piece in the past tone. */
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
  return <EmptyState art={ART[art]} tone={art === 'stencil' ? 'past' : 'default'} title={title} body={body} actions={actions} className={className} />;
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
              <Button variant="primary" onClick={onUpload} kbd="U" icon={<Upload size={16} strokeWidth={1.75} aria-hidden />}>
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
          actions={
            <>
              <Button variant="outline" onClick={onUpload} icon={<Upload size={16} strokeWidth={1.75} aria-hidden />}>
                Upload files
              </Button>
              <Button variant="ghost" onClick={onNewFolder} icon={<FolderPlus size={16} strokeWidth={1.75} aria-hidden />}>
                New folder
              </Button>
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
          art="missing"
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
          art="missing"
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
