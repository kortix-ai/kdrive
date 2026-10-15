import { AUDIT_KINDS, formatBytes, shortId } from '@volumes/shared';

const LABELS: Record<string, string> = {
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.sign_up': 'Account created',
  'auth.sign_in_failed': 'Sign-in failed',
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
  'billing.config_key': 'Stripe key connected',
  'billing.config_prices': 'Plan prices set',
  'billing.config_webhook': 'Stripe webhook set up',
  'billing.config_disconnect': 'Stripe disconnected',
  'admin.add': 'Admin added',
  'admin.remove': 'Admin removed',
  'admin.denied': 'Admin access refused',
  'agent.token.create': 'Agent token created',
  'agent.token.revoke': 'Agent token revoked',
  'agent.grant.create': 'Agent connected',
  'agent.grant.update': 'Agent access changed',
  'agent.grant.revoke': 'Agent disconnected',
  'agent.write': 'Agent changed files',
  'agent.restore': 'Agent restored',
  'agent.undo': 'Agent undid a change',
  'agent.checkpoint': 'Agent made a checkpoint',
  'proposal.create': 'Changes proposed',
  'proposal.accept': 'Proposal accepted',
  'proposal.discard': 'Proposal discarded',
};

/** "Signed in", "Link revoked" … (falls back to the raw kind). */
export function auditLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}

/** Audit kinds in families, for the admin log's event filter (every kind is in exactly one). */
export const AUDIT_GROUPS: { id: string; label: string; kinds: string[] }[] = (() => {
  const groups = [
    { id: 'account', label: 'Sign-in and account', test: (k: string) => k.startsWith('auth.') || k.startsWith('account.') },
    { id: 'drives', label: 'Drives and sharing', test: (k: string) => k.startsWith('workspace.') },
    { id: 'restore', label: 'Restores and undo', test: (k: string) => k.startsWith('restore.') || k === 'undo' },
    { id: 'links', label: 'Links and checkpoints', test: (k: string) => k.startsWith('link.') || k.startsWith('checkpoint.') },
    { id: 'storage', label: 'Storage and plans', test: (k: string) => k.startsWith('storage.') || k.startsWith('billing.') || k === 'quota.change' },
    { id: 'admin', label: 'Admins', test: (k: string) => k.startsWith('admin.') },
    { id: 'agents', label: 'AI agents', test: (k: string) => k.startsWith('agent.') || k.startsWith('proposal.') },
  ];
  const out = groups.map((g) => ({ id: g.id, label: g.label, kinds: AUDIT_KINDS.filter(g.test) as string[] }));
  const rest = AUDIT_KINDS.filter((k) => !groups.some((g) => g.test(k)));
  if (rest.length) out.push({ id: 'other', label: 'Other', kinds: [...rest] });
  return out;
})();

/** Badge tone: destructive kinds read red, checkpoints and links blue, sign-ins dashed, the rest neutral (never amber). */
export function auditTone(kind: string): 'neutral' | 'dashed' | 'danger' | 'accent' {
  if (kind === 'account.delete' || kind === 'workspace.delete' || kind === 'link.revoke' || kind === 'checkpoint.delete' || kind === 'admin.remove') return 'danger';
  if (kind === 'auth.sign_in_failed' || kind === 'admin.denied') return 'danger';
  if (kind === 'admin.add') return 'accent';
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
