// Upload sources: drag-and-drop (keeps the tree and empty dirs through
// DataTransferItem.webkitGetAsEntry), <input multiple> and <input webkitdirectory>.

export interface SourceFile {
  file: File;
  /** Relative path inside the drop, `/`-separated, no leading slash (`Photos/2024/a.jpg`). */
  relPath: string;
}

export interface UploadSources {
  files: SourceFile[];
  /** Every directory seen, relative (`Photos`, `Photos/empty`). Empty ones are kept by the plan. */
  dirs: string[];
}

/** OS clutter that never gets uploaded. */
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);
export const isJunkName = (name: string) => JUNK.has(name) || name.startsWith('._');

export function hasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes('Files');
}

/** Number of top-level items being dragged (files or folders), while the drag is in progress. */
export function dragItemCount(dt: DataTransfer | null | undefined): number {
  if (!dt) return 0;
  let n = 0;
  for (const it of Array.from(dt.items ?? [])) if (it.kind === 'file') n++;
  return n || dt.files?.length || 0;
}

function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const step = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(out);
        else {
          out.push(...batch);
          step();
        }
      }, reject);
    step();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: UploadSources): Promise<void> {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (isJunkName(entry.name)) return;
    try {
      out.files.push({ file: await entryFile(entry as FileSystemFileEntry), relPath: rel });
    } catch {
      /* unreadable (permissions): skipped */
    }
  } else if (entry.isDirectory) {
    out.dirs.push(rel);
    const children = await readAllEntries(entry as FileSystemDirectoryEntry).catch(() => [] as FileSystemEntry[]);
    for (const c of children) await walkEntry(c, rel, out);
  }
}

/**
 * Reads a drop. MUST be called synchronously inside the `drop` handler: the
 * entries are captured before the first await (the DataTransfer is emptied after).
 */
export function collectDrop(dt: DataTransfer): Promise<UploadSources> {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) loose.push(f);
    }
  }
  if (!entries.length && !loose.length) loose.push(...Array.from(dt.files ?? []));
  return (async () => {
    const out: UploadSources = { files: [], dirs: [] };
    for (const e of entries) await walkEntry(e, '', out);
    for (const f of loose) if (!isJunkName(f.name)) out.files.push({ file: f, relPath: f.name });
    return out;
  })();
}

/** Files from an <input> (uses webkitRelativePath for folder pickers). */
export function sourcesFromFiles(list: FileList | File[]): UploadSources {
  const files: SourceFile[] = [];
  const dirs = new Set<string>();
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const segs = rel.split('/').filter(Boolean);
    if (!segs.length || isJunkName(segs[segs.length - 1])) continue;
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
    files.push({ file: f, relPath: segs.join('/') });
  }
  return { files, dirs: [...dirs] };
}

/**
 * Opens the OS picker (files, or a folder with `folder`). Resolves null when
 * the picker is dismissed. Must run inside a user gesture (click / keydown).
 */
export function pickUploadSources(folder: boolean): Promise<UploadSources | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    let settled = false;
    const done = (v: UploadSources | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const files = input.files;
      done(files && files.length ? sourcesFromFiles(files) : null);
    });
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}
