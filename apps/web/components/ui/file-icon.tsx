import { Link2 } from 'lucide-react';
import { extname, previewKind } from '@volumes/shared';
import { cx } from './cx';

/** The tinted tile families (UNIFY-SPEC §2.5). Each maps to a `--vx-ft-*` token. */
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

const G = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

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
        <text x="12" y="14.4" fontSize="6" fontWeight="700" textAnchor="middle" fontFamily="var(--vx-font-mono)" fill="currentColor">
          PDF
        </text>
      );
    case 'slides':
      return <path d="M7 8.5h10v7H7zM10 18h4" {...G} strokeWidth={1.6} />;
    case 'image':
    case 'photo':
      return (
        <>
          <circle cx="9" cy="9" r="1.7" fill="currentColor" />
          <path d="M6 17.5l4-4.5 3 3 2.2-2.2 2.8 3.7" {...G} strokeWidth={1.6} />
        </>
      );
    case 'video':
      return <path d="M10 8.5v7l6-3.5z" fill="currentColor" />;
    case 'audio':
      return (
        <>
          <path d="M11 16V8l5-1.2v7.7" {...G} strokeWidth={1.6} />
          <circle cx="9.4" cy="16" r="1.7" fill="currentColor" />
          <circle cx="14.4" cy="14.5" r="1.7" fill="currentColor" />
        </>
      );
    case 'code':
      return <path d="M10 9l-3 3 3 3M14 9l3 3-3 3" {...G} strokeWidth={1.6} />;
    case 'archive':
      return <path d="M12 5v2M12 9v2M12 13v2M10.5 16.5h3v2.5h-3z" {...G} strokeWidth={1.5} />;
    default:
      return <circle cx="12" cy="12" r="1.6" fill="currentColor" />;
  }
}

/** The seven object hues (oklch hue angles, mirrored by --hue-* in globals.css). No violet. */
export const OBJECT_HUES = [32, 72, 118, 162, 205, 262, 352] as const;

/** A stable hue for a named object (a folder, a drive): the same name always gets the same colour. */
export function objectHue(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OBJECT_HUES[(h >>> 0) % OBJECT_HUES.length];
}

/**
 * The folder at list scale: the glass object flattened to a solid back + tab and a lighter front, in the
 * folder's own hue (objectHue), so a row, a crumb and its card agree.
 */
function FolderGlyph({ name, size, muted }: { name: string; size: number; muted?: boolean }) {
  const h = objectHue(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden data-kind="folder" className={cx('inline-block shrink-0', muted && 'opacity-50')}>
      <path d="M3 7.2a2 2 0 0 1 2-2h4.6l2 2.2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" style={{ fill: `oklch(0.60 0.11 ${h})` }} />
      <rect x="3" y="9.6" width="18" height="9.4" rx="2" style={{ fill: `oklch(0.76 0.105 ${h})` }} />
      <rect x="3.6" y="10.1" width="16.8" height="1" rx=".5" fill="rgba(255,255,255,.45)" />
    </svg>
  );
}

/**
 * File-type icon: a flat tinted tile (the kind's `--vx-ft-*` mixed into the surface, a faint ring of the same
 * hue) with the glyph in the kind's colour, drawn in a `size` px box (rows 28, cards 20–24, mats 48/64).
 * Folders are the flattened glass folder in their own hue; links an outline link; `shared` adds a small
 * person badge. `muted` dims the icon (ghost rows, unrestorable items).
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
  if (kind === 'folder') {
    return (
      <span className={cx('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }} aria-hidden>
        <FolderGlyph name={name} size={size} muted={muted} />
        {shared ? (
          <svg className="absolute" style={{ right: 0, bottom: 0 }} width={Math.max(9, size * 0.4)} height={Math.max(9, size * 0.4)} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="5" fill="var(--vx-text-1)" />
            <circle cx="5" cy="3.9" r="1.5" fill="var(--vx-surface)" />
            <path d="M2.6 7.8a2.4 2.4 0 0 1 4.8 0z" fill="var(--vx-surface)" />
          </svg>
        ) : null}
      </span>
    );
  }
  if (kind === 'link') {
    return (
      <span className={cx('relative inline-flex items-center justify-center', cls)} style={{ width: size, height: size, color: fileKindColor(kind) }} aria-hidden>
        <Link2 size={Math.round(size * 0.7)} strokeWidth={1.75} />
      </span>
    );
  }
  const c = fileKindColor(kind);
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 24 24" aria-hidden data-kind={kind} style={{ color: c }}>
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="6.5"
        style={{
          fill: `color-mix(in oklab, ${c} 13%, var(--vx-surface))`,
          stroke: `color-mix(in oklab, ${c} 26%, transparent)`,
        }}
        strokeWidth={24 / size}
      />
      <g transform="translate(12 12) scale(1.18) translate(-12 -12)">
        <Glyph kind={kind} />
      </g>
    </svg>
  );
}

export default FileIcon;
