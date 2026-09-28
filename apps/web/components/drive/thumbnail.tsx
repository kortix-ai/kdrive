'use client';

// Grid thumbnail on the 4:3 mat. Only raster images up to IMAGE_THUMB_MAX_BYTES
// load their bytes (lazy); SVG and other active content never render as images.
// Everything else shows a type glyph + extension label.
import { useState } from 'react';
import { IMAGE_THUMB_MAX_BYTES, extname, isActiveContent, previewKind, type FileEntry } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { contentUrl } from '@/lib/urls';
import s from './drive.module.css';

export function canThumb(e: Pick<FileEntry, 'name' | 'type' | 'size'>): boolean {
  return e.type === 'file' && previewKind(e.name) === 'image' && !isActiveContent(e.name) && e.size > 0 && e.size <= IMAGE_THUMB_MAX_BYTES;
}

export default function Thumbnail({ ws, entry, at, past }: { ws: string; entry: FileEntry; at: string | null; past?: boolean }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const thumb = canThumb(entry);
  const ext = extname(entry.name).replace('.', '');
  return (
    <div className={cx(s.mat, past && s.pastFilter)}>
      <div className={s.matInner}>
        {thumb && state !== 'error' ? (
          <>
            {state === 'loading' ? <span className="skeleton absolute inset-0" aria-hidden /> : null}
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
        ) : (
          <>
            <span className="absolute inset-0 flex items-center justify-center">
              <FileIcon name={entry.name} type={entry.type} size={32} className="text-vx-text-3" />
            </span>
            {ext ? <span className="vx-label absolute bottom-2 left-2 text-vx-text-4">{ext.slice(0, 8)}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
