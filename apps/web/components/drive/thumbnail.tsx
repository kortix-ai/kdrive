'use client';

// Grid thumbnail on the file card's mat (DESIGN-v2 §6.2): r8, `--vx-mat`, filling the space
// between the card head and caption. Only raster images up to IMAGE_THUMB_MAX_BYTES load
// their bytes (lazy, object-fit: cover). Video gets a dark mat with a play disc. Active
// content (svg, html, xml, js) never renders: its glyph + a `Shown as text` badge. Everything
// else shows its 48 px type tile centred. In the past the mat takes `--vx-past-filter`.
import { useState } from 'react';
import { IMAGE_THUMB_MAX_BYTES, isActiveContent, previewKind, type FileEntry } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { contentUrl } from '@/lib/urls';
import s from './drive.module.css';

export function canThumb(e: Pick<FileEntry, 'name' | 'type' | 'size'>): boolean {
  return e.type === 'file' && previewKind(e.name) === 'image' && !isActiveContent(e.name) && e.size > 0 && e.size <= IMAGE_THUMB_MAX_BYTES;
}

export default function Thumbnail({
  ws,
  entry,
  at,
  past,
  children,
}: {
  ws: string;
  entry: FileEntry;
  at: string | null;
  past?: boolean;
  /** Overlays on the mat (drift chip, restore). */
  children?: React.ReactNode;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const thumb = canThumb(entry);
  const active = entry.type === 'file' && isActiveContent(entry.name);
  const video = !active && entry.type === 'file' && previewKind(entry.name) === 'video';
  return (
    <div className={cx(s.mat, video && s.videoMat, past && s.pastFilter)}>
      <div className={s.matInner}>
        {thumb && state !== 'error' ? (
          <>
            {state === 'loading' ? <span className="skeleton absolute inset-0 !rounded-none" aria-hidden /> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={contentUrl(ws, entry.path, { at })}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setState('ok')}
              onError={() => setState('error')}
              className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-[120ms]', state === 'ok' ? 'opacity-100' : 'opacity-0')}
            />
          </>
        ) : video ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className={s.playDisc} aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M5 3.2v9.6L13 8z" fill="currentColor" />
              </svg>
            </span>
          </span>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <FileIcon name={entry.name} type={entry.type} size={48} />
            {active ? <Badge tone="dashed">Shown as text</Badge> : null}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
