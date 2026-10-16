'use client';

import { TEXT_PREVIEW_MAX_BYTES, isActiveContent, previewKind } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { AudioView } from './audio-view';
import { CodeView } from './code-view';
import { CsvView } from './csv-view';
import { ImageView } from './image-view';
import { MarkdownView } from './markdown-view';
import { PdfView } from './pdf-view';
import { TooLarge } from './states';
import { TextView } from './text-view';
import { UnsupportedView } from './unsupported-view';
import { VideoView } from './video-view';

export type Renderer = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'code' | 'source' | 'text' | 'json' | 'csv' | 'too-large' | 'none';

/**
 * Which renderer a file gets. Active content (HTML, SVG, XML, JS) is always `source`:
 * its text in the code view, never rendered, never an `<img>`.
 */
export function rendererFor(name: string, size: number): Renderer {
  const active = isActiveContent(name);
  const kind = previewKind(name);
  const textual = active || kind === 'markdown' || kind === 'code' || kind === 'text' || kind === 'json' || kind === 'csv';
  if (textual && size > TEXT_PREVIEW_MAX_BYTES) return 'too-large';
  if (active) return 'source';
  switch (kind) {
    case 'image':
    case 'pdf':
    case 'video':
    case 'audio':
    case 'markdown':
    case 'code':
    case 'text':
    case 'json':
    case 'csv':
      return kind;
    default:
      return 'none';
  }
}

export interface FilePreviewProps {
  /** inline content URL (the API serves active content as text/plain) */
  src: string;
  /** attachment URL; null when downloads are off (a view-only share link) */
  downloadHref: string | null;
  name: string;
  size: number;
  /** optional extras for the unknown-type specimen block */
  version?: string | null;
  mime?: string;
  /** image zoom keys (+ - 0 1); default on */
  keys?: boolean;
  className?: string;
}

/** The renderer for one file, shared by the preview panel and the public share page. */
export function FilePreview({ src, downloadHref, name, size, version, mime, keys = true, className }: FilePreviewProps) {
  const r = rendererFor(name, size);
  let body: React.ReactNode;
  switch (r) {
    case 'too-large':
      body = <TooLarge size={size} downloadHref={downloadHref} />;
      break;
    case 'image':
      body = <ImageView key={src} src={src} name={name} keys={keys} />;
      break;
    case 'pdf':
      body = <PdfView key={src} src={src} name={name} />;
      break;
    case 'video':
      body = <VideoView key={src} src={src} name={name} viewOnly={!downloadHref} />;
      break;
    case 'audio':
      body = <AudioView key={src} src={src} name={name} viewOnly={!downloadHref} />;
      break;
    case 'markdown':
      body = <MarkdownView key={src} src={src} />;
      break;
    case 'code':
    case 'source':
      body = <CodeView key={src} src={src} name={name} />;
      break;
    case 'json':
      body = <TextView key={src} src={src} kind="json" />;
      break;
    case 'text':
      body = <TextView key={src} src={src} kind="text" />;
      break;
    case 'csv':
      body = <CsvView key={src} src={src} />;
      break;
    default:
      body = <UnsupportedView name={name} size={size} downloadHref={downloadHref} version={version} mime={mime} />;
  }
  return (
    <div className={cx('min-w-0', className)} data-renderer={r}>
      {body}
    </div>
  );
}

export default FilePreview;
