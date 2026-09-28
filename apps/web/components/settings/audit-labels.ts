import { formatBytes } from '@volumes/shared';

const LABELS: Record<string, string> = {
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'account.delete': 'Account deleted',
  'workspace.create': 'Workspace created',
  'workspace.duplicate': 'Workspace duplicated',
  'workspace.delete': 'Workspace deleted',
  'restore.file': 'File restored',
  'restore.folder': 'Folder restored',
  'restore.drive': 'Drive restored',
  undo: 'Undone',
  'checkpoint.create': 'Checkpoint created',
  'checkpoint.update': 'Checkpoint edited',
  'checkpoint.delete': 'Checkpoint removed',
  'link.create': 'Link created',
  'link.update': 'Link changed',
  'link.revoke': 'Link revoked',
  'quota.change': 'Quota changed',
};

/** "Signed in", "Link revoked" … (falls back to the raw kind). */
export function auditLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}

/** Badge tone: destructive kinds read red, restores amber-free neutral, the rest neutral. */
export function auditTone(kind: string): 'default' | 'dim' | 'danger' | 'accent' {
  if (kind === 'account.delete' || kind === 'workspace.delete' || kind === 'link.revoke' || kind === 'checkpoint.delete') return 'danger';
  if (kind.startsWith('checkpoint.') || kind.startsWith('link.')) return 'accent';
  if (kind.startsWith('auth.')) return 'dim';
  return 'default';
}

/** One-line detail from an event's meta (known keys first; secrets are never in meta). */
export function auditDetail(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  const m = meta ?? {};
  if (typeof m.from === 'number' && typeof m.to === 'number') parts.push(`${formatBytes(m.from)} → ${formatBytes(m.to)}`);
  if (typeof m.name === 'string') parts.push(m.name);
  if (typeof m.mode === 'string') parts.push(m.mode);
  if (typeof m.at === 'string') parts.push(`@${m.at.replace(/^[a-z]{2,4}_/i, '').slice(0, 7).toLowerCase()}`);
  if (typeof m.path === 'string') parts.push(m.path);
  if (typeof m.email === 'string') parts.push(m.email);
  if (parts.length === 0) {
    for (const [k, v] of Object.entries(m)) {
      if (k === 'ip' || v === null || typeof v === 'object') continue;
      parts.push(`${k}: ${String(v)}`);
      if (parts.length >= 3) break;
    }
  }
  return parts.join(' · ');
}
