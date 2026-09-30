import { createHash, randomBytes } from 'node:crypto';
import { AGENT_TOKEN_PREFIX } from '@volumes/shared';

const TOKEN_RE = /^vx_pat_[A-Za-z0-9_-]{43}$/;

/**
 * A new agent token: `vx_pat_` + 43 base64url chars (32 random bytes).
 * Only `hash` (SHA-256 hex) is stored; `prefix` (first 12 chars) is for display.
 * The secret is returned to the user once and never logged.
 */
export function generateAgentToken(): { secret: string; hash: string; prefix: string } {
  const secret = AGENT_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { secret, hash: hashAgentToken(secret), prefix: secret.slice(0, 12) };
}

export function hashAgentToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function looksLikeAgentToken(s: string): boolean {
  return TOKEN_RE.test(s);
}
