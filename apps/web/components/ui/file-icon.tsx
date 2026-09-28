import { Folder, Link2 } from 'lucide-react';
import { extname, previewKind } from '@volumes/shared';
import { cx } from './cx';

/** The coloured tile families (DESIGN-v2 §4.1). Each maps to a `--vx-ft-*` token. */
export type FileKind = 'folder' | 'link' | 'markdown' | 'doc' | 'sheet' | 'pdf' | 'slides' | 'image' | 'photo' | 'video' | 'audio' | 'code' | 'archive' | 'other';

const ARCHIVES = new Set(['.zip', '.gz', '.tar', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.zst']);
const DOCS = new Set(['.txt', '.rtf', '.doc', '.docx', '.odt', '.pages', '.log']);
const SHEETS = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.ods', '.numbers']);
const SLIDES = new Set(['.ppt', '.pptx', '.key', '.odp']);
const PHOTOS = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.raw', '.dng', '.cr2', '.nef', '.arw']);
const IMAGES = new Set(['.png', '.gif', '.webp', '.bmp', '.avif', '.tif', '.tiff', '.ico']);

/** Which tile a name gets. Active content (svg, html, xml, js) is always `code`. */
export function fileKind(name: string, type: 'file' | 'dir' | 'symlink' | 'other'): FileKind {
  if (type === 'dir') return 'folder';
  if (type === 'symlink') return 'link';
  const ext = extname(name).toLowerCase();
  if (ARCHIVES.has(ext)) return 'archive';
  if (SHEETS.has(ext)) return 'sheet';
  if (SLIDES.has(ext)) return 'slides';
  if (DOCS.has(ext)) return 'doc';
  if (PHOTOS.has(ext)) return 'photo';
  if (IMAGES.has(ext)) return 'image';
  switch (previewKind(name)) {
    case 'markdown':
      return 'markdown';
    case 'text':
      return 'doc';
    case 'csv':
      return 'sheet';
    case 'pdf':
      return 'pdf';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'json':
    case 'code':
      return 'code';
    default:
      return 'other';
  }
}

/** CSS colour of a kind's tile (for mats, bars or legends). */
export function fileKindColor(kind: FileKind): string {
  return kind === 'folder' ? 'var(--vx-ft-folder)' : kind === 'link' ? 'var(--vx-ft-other)' : `var(--vx-ft-${kind === 'markdown' ? 'doc' : kind})`;
}

const G = { fill: 'none', stroke: 'var(--vx-ft-glyph)', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Glyph({ kind }: { kind: FileKind }) {
  switch (kind) {
    case 'markdown':
      return <path d="M7 15.5v-7l2.5 3.2L12 8.5v7M16 8.5v7M14 13.4l2 2.1 2-2.1" {...G} strokeWidth={1.6} />;
    case 'doc':
      return <path d="M7.5 8h9M7.5 12h9M7.5 16h6" {...G} strokeWidth={1.6} />;
    case 'sheet':
      return <path d="M7 7.5h10v9H7zM7 10.5h10M7 13.5h10M12 7.5v9" {...G} strokeWidth={1.4} />;
    case 'pdf':
      return (
        <text x="12" y="14.6" fontSize="6.4" fontWeight="800" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fill="var(--vx-ft-glyph)">
          PDF
        </text>
      );
    case 'slides':
      return <path d="M7 8.5h10v7H7zM10 18h4" {...G} strokeWidth={1.6} />;
    case 'image':
    case 'photo':
      return (
        <>
          <circle cx="9" cy="9" r="1.7" fill="var(--vx-ft-glyph)" />
          <path d="M6 17.5l4-4.5 3 3 2.2-2.2 2.8 3.7" {...G} strokeWidth={1.6} />
        </>
      );
    case 'video':
      return <path d="M10 8.5v7l6-3.5z" fill="var(--vx-ft-glyph)" />;
    case 'audio':
      return (
        <>
          <path d="M11 16V8l5-1.2v7.7" {...G} strokeWidth={1.6} />
          <circle cx="9.4" cy="16" r="1.7" fill="var(--vx-ft-glyph)" />
          <circle cx="14.4" cy="14.5" r="1.7" fill="var(--vx-ft-glyph)" />
        </>
      );
    case 'code':
      return <path d="M10 9l-3 3 3 3M14 9l3 3-3 3" {...G} strokeWidth={1.6} />;
    case 'archive':
      return <path d="M12 5v2M12 9v2M12 13v2M10.5 16.5h3v2.5h-3z" {...G} strokeWidth={1.5} />;
    default:
      return <circle cx="12" cy="12" r="1.6" fill="var(--vx-ft-glyph)" />;
  }
}

/**
 * File-type icon (DESIGN-v2 §4.1): a rounded tile in `--vx-ft-*` with a glyph in `--vx-ft-glyph`,
 * drawn in a `size` px box (24 default: rows use 24, panel heads 32, grid mats 48). Folders are
 * an outline folder in `--vx-ft-folder`; `shared` adds a small person badge.
 * `muted` dims the icon (ghost rows, unrestorable items).
 */
export function FileIcon({
  name,
  type,
  size = 24,
  className,
  shared,
  muted,
}: {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size?: number;
  className?: string;
  shared?: boolean;
  muted?: boolean;
}) {
  const kind = fileKind(name, type);
  const cls = cx('inline-block shrink-0', muted && 'opacity-50', className);
  if (kind === 'folder' || kind === 'link') {
    const Icon = kind === 'folder' ? Folder : Link2;
    return (
      <span className={cx('relative inline-flex items-center justify-center', cls)} style={{ width: size, height: size, color: fileKindColor(kind) }} aria-hidden>
        <Icon size={Math.round(size * 0.84)} strokeWidth={1.75} />
        {shared ? (
          <svg className="absolute" style={{ right: 0, bottom: 0 }} width={Math.max(9, size * 0.4)} height={Math.max(9, size * 0.4)} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="5" fill="var(--vx-ft-folder)" />
            <circle cx="5" cy="3.9" r="1.5" fill="var(--vx-surface)" />
            <path d="M2.6 7.8a2.4 2.4 0 0 1 4.8 0z" fill="var(--vx-surface)" />
          </svg>
        ) : null}
      </span>
    );
  }
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 24 24" aria-hidden data-kind={kind}>
      <rect x="3" y="2" width="18" height="20" rx="3.5" fill={fileKindColor(kind)} />
      <Glyph kind={kind} />
    </svg>
  );
}

export default FileIcon;
