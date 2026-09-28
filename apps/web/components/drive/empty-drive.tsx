'use client';

// Teaching empty states for the drive (DESIGN §6.11). Voxel art in the
// Platinum `.ea` idiom: grayscale slabs, one purple dot, a gentle bob that is
// static under reduced motion.
import { RETENTION_COPY } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cx } from '@/components/ui/cx';

type Art = 'stack' | 'slab' | 'stencil' | 'search';

function Slab({ y, accent, dashed }: { y: number; accent?: boolean; dashed?: boolean }) {
  if (dashed) {
    return (
      <g transform={`translate(0 ${y})`}>
        <path d="M60 20 L100 40 L60 60 L20 40 Z" fill="none" stroke="var(--ea-line)" strokeDasharray="3 3" />
        <path d="M20 40 L20 52 L60 72 L100 52 L100 40" fill="none" stroke="var(--ea-line-dim)" strokeDasharray="3 3" />
      </g>
    );
  }
  return (
    <g transform={`translate(0 ${y})`}>
      <path d="M60 20 L100 40 L60 60 L20 40 Z" fill={accent ? 'var(--ea-p-face)' : 'var(--ea-top)'} stroke="var(--ea-line)" />
      <path d="M20 40 L60 60 L60 72 L20 52 Z" fill="var(--ea-left)" stroke="var(--ea-line)" />
      <path d="M60 60 L100 40 L100 52 L60 72 Z" fill="var(--ea-mid)" stroke="var(--ea-line)" />
    </g>
  );
}

function Block({ x, y, s = 10 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 ${s / 2} L${s} 0 L${2 * s} ${s / 2} L${s} ${s} Z`} fill="var(--ea-top)" stroke="var(--ea-line)" />
      <path d={`M0 ${s / 2} L${s} ${s} L${s} ${2 * s} L0 ${1.5 * s} Z`} fill="var(--ea-left)" stroke="var(--ea-line)" />
      <path d={`M${s} ${s} L${2 * s} ${s / 2} L${2 * s} ${1.5 * s} L${s} ${2 * s} Z`} fill="var(--ea-mid)" stroke="var(--ea-line)" />
    </g>
  );
}

function ArtFor({ art }: { art: Art }) {
  return (
    <div className="ea mb-6 flex flex-col items-center" aria-hidden>
      <div className="ea-float">
        <svg width="120" height="120" viewBox="0 0 120 120">
          {art === 'stack' ? (
            <>
              <Slab y={36} />
              <Slab y={24} />
              <Block x={50} y={4} />
              <rect x="57" y="-2" width="5" height="5" fill="var(--ea-accent)" transform="rotate(45 59.5 0.5)" />
            </>
          ) : art === 'slab' ? (
            <>
              <Slab y={28} />
              <rect x="57" y="44" width="5" height="5" fill="var(--ea-accent)" transform="rotate(45 59.5 46.5)" />
            </>
          ) : art === 'search' ? (
            <>
              <Slab y={28} dashed />
              <Block x={24} y={40} />
              <rect x="31" y="36" width="5" height="5" fill="var(--ea-accent)" transform="rotate(45 33.5 38.5)" />
            </>
          ) : (
            <>
              <Slab y={30} dashed />
              <Slab y={16} dashed />
              <rect x="57" y="30" width="5" height="5" fill="var(--ea-accent)" transform="rotate(45 59.5 32.5)" />
            </>
          )}
        </svg>
      </div>
      <div className="ea-shadow" style={{ width: 64, height: 6, background: 'radial-gradient(closest-side, var(--ea-shadow), transparent)', opacity: 0.3 }} />
    </div>
  );
}

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
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <ArtFor art={art} />
      <div className="vx-title">{title}</div>
      {body ? <p className="vx-body mt-2 max-w-[440px] text-vx-text-3">{body}</p> : null}
      {actions ? <div className="mt-5 flex items-center gap-3">{actions}</div> : null}
    </div>
  );
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
  switch (state.kind) {
    case 'drive':
      return (
        <DriveEmpty
          art="stack"
          title="Drop files or folders here."
          body="Every drop becomes a version you can come back to. The strip below records each one."
          actions={
            <>
              <Button variant="primary" onClick={onUpload} kbd="U">
                Upload
              </Button>
              <button type="button" onClick={onNewFolder} className="vx-ui inline-flex items-center gap-1.5 text-vx-text-3 hover:text-vx-text-1">
                <Kbd>N</Kbd> new folder
              </button>
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
      return (
        <DriveEmpty
          art="stencil"
          title={`This folder did not exist on ${state.when}.`}
          actions={
            <Button variant="primary" onClick={onBackToNow} kbd="Esc">
              Back to now
            </Button>
          }
        />
      );
    case 'past-empty':
      return (
        <DriveEmpty
          art="stencil"
          title={`This folder was empty on ${state.when}.`}
          actions={
            <Button variant="primary" onClick={onBackToNow} kbd="Esc">
              Back to now
            </Button>
          }
        />
      );
    case 'version-gone':
      return (
        <DriveEmpty
          art="stencil"
          title="This version is no longer kept."
          body={RETENTION_COPY}
          actions={
            <Button variant="primary" onClick={onBackToNow} kbd="Esc">
              Back to now
            </Button>
          }
        />
      );
    case 'missing':
      return (
        <DriveEmpty
          art="stencil"
          title="This folder doesn't exist."
          body="It may have been moved or deleted. Recently deleted keeps items while their history is kept."
          actions={
            <Button variant="secondary" onClick={onGoHome}>
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
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      );
  }
}
