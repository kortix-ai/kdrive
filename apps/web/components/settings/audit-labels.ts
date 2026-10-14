import { formatBytes, shortId } from '@volumes/shared';

const LABELS: Record<string, string> = {
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.sign_up': 'Account created',
  'auth.email_verify': 'Email verified',
  'auth.email_change': 'Email changed',
  'auth.password_change': 'Password changed',
  'auth.password_reset': 'Password reset',
  'account.delete': 'Account deleted',
  'workspace.create': 'Drive created',
  'workspace.duplicate': 'Drive duplicated',
  'workspace.invite': 'Person invited to a drive',
  'workspace.invite_revoke': 'Drive invitation withdrawn',
  'workspace.member_join': 'Joined a drive',
  'workspace.member_update': 'Drive access changed',
  'workspace.member_remove': 'Person removed from a drive',
  'workspace.member_leave': 'Left a drive',
  'workspace.delete': 'Drive deleted',
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
  'storage.request': 'More storage requested',
  'storage.grant': 'Storage request granted',
  'storage.dismiss': 'Storage request dismissed',
  'billing.plan_change': 'Plan changed',
};

/** "Signed in", "Link revoked" … (falls back to the raw kind). */
export function auditLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}

/** Badge tone: destructive kinds read red, checkpoints and links blue, sign-ins dashed, the rest neutral (never amber). */
export function auditTone(kind: string): 'neutral' | 'dashed' | 'danger' | 'accent' {
  if (kind === 'account.delete' || kind === 'workspace.delete' || kind === 'link.revoke' || kind === 'checkpoint.delete') return 'danger';
  if (kind.startsWith('checkpoint.') || kind.startsWith('link.')) return 'accent';
  if (kind.startsWith('auth.')) return 'dashed';
  return 'neutral';
}

/** One-line detail from an event's meta (known keys first; secrets are never in meta). */
export function auditDetail(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  const m = meta ?? {};
  if (typeof m.from === 'number' && typeof m.to === 'number') parts.push(`${formatBytes(m.from)} → ${formatBytes(m.to)}`);
  if (typeof m.name === 'string') parts.push(m.name);
  if (typeof m.plan === 'string') parts.push(m.plan.charAt(0).toUpperCase() + m.plan.slice(1));
  if (typeof m.mode === 'string') parts.push(m.mode);
  if (typeof m.at === 'string') parts.push(shortId(m.at));
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
