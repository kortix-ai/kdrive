import { File, FileArchive, FileBraces, FileCode, FileImage, FileMusic, FilePlay, FileSpreadsheet, FileText, Folder, Link2, type LucideIcon } from 'lucide-react';
import { extname, previewKind } from '@volumes/shared';

const ARCHIVES = new Set(['.zip', '.gz', '.tar', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.zst']);

/** Type-specific lucide icon from `previewKind`. */
export function iconFor(name: string, type: 'file' | 'dir' | 'symlink' | 'other'): LucideIcon {
  if (type === 'dir') return Folder;
  if (type === 'symlink') return Link2;
  if (ARCHIVES.has(extname(name))) return FileArchive;
  switch (previewKind(name)) {
    case 'image':
      return FileImage;
    case 'video':
      return FilePlay;
    case 'audio':
      return FileMusic;
    case 'pdf':
    case 'markdown':
    case 'text':
      return FileText;
    case 'csv':
      return FileSpreadsheet;
    case 'json':
      return FileBraces;
    case 'code':
      return FileCode;
    default:
      return File;
  }
}

export function FileIcon({ name, type, size = 16, className }: { name: string; type: 'file' | 'dir' | 'symlink' | 'other'; size?: number; className?: string }) {
  const Icon = iconFor(name, type);
  return <Icon size={size} strokeWidth={1.5} className={className ?? (type === 'dir' ? 'text-vx-text-2' : 'text-vx-text-3')} aria-hidden />;
}

export default FileIcon;
