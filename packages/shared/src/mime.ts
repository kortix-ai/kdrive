import { extname } from './paths';

export type PreviewKind =
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'markdown'
  | 'csv'
  | 'json'
  | 'code'
  | 'text'
  | 'none';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml',
  '.xml': 'application/xml',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.wasm': 'application/wasm',
};

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico']);
const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv']);
const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.opus']);

/** Extension → shiki language id. */
const CODE_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.lua': 'lua',
  '.r': 'r',
  '.dart': 'dart',
  '.scala': 'scala',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.dockerfile': 'docker',
  '.tf': 'hcl',
  '.proto': 'proto',
  '.diff': 'diff',
  '.patch': 'diff',
};

const TEXT = new Set(['.txt', '.log', '.env.example', '.gitignore', '.editorconfig', '.conf', '.cfg', '.rst', '.tex']);
const ACTIVE = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs', '.cjs']);
const BARE_TEXT_NAMES = new Set(['readme', 'license', 'makefile', 'dockerfile', 'changelog', 'authors', 'notice']);

function nameOf(pathOrName: string): string {
  const i = pathOrName.lastIndexOf('/');
  return i >= 0 ? pathOrName.slice(i + 1) : pathOrName;
}

/** Content-Type for a file name (falls back to application/octet-stream). */
export function mimeFor(name: string): string {
  const ext = extname(nameOf(name));
  if (MIME[ext]) return MIME[ext];
  if (CODE_LANG[ext] || TEXT.has(ext)) return 'text/plain; charset=utf-8';
  if (BARE_TEXT_NAMES.has(nameOf(name).toLowerCase())) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** How the preview panel renders a file. Active content previews as code (source). */
export function previewKind(name: string): PreviewKind {
  const base = nameOf(name);
  const ext = extname(base);
  if (ext === '.svg') return 'code';
  if (IMAGE.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'audio';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.json') return 'json';
  if (CODE_LANG[ext]) return 'code';
  if (TEXT.has(ext)) return 'text';
  if (BARE_TEXT_NAMES.has(base.toLowerCase())) return 'text';
  return 'none';
}

/** Shiki language id for code previews ('text' when unknown). */
export function codeLanguage(name: string): string {
  const base = nameOf(name);
  if (base.toLowerCase() === 'dockerfile') return 'docker';
  if (base.toLowerCase() === 'makefile') return 'make';
  return CODE_LANG[extname(base)] ?? 'text';
}

/** HTML, SVG, XML and JS are never rendered inline on the app origin. */
export function isActiveContent(name: string): boolean {
  return ACTIVE.has(extname(nameOf(name)));
}

/** Files that preview (and diff) as text. */
export function isTextLike(name: string): boolean {
  const k = previewKind(name);
  return k === 'text' || k === 'code' || k === 'markdown' || k === 'json' || k === 'csv';
}
