import type { AgentMode, AgentScope } from '@volumes/shared';

/** Drive access levels, lowest first; each implies the ones before it. */
export const AGENT_SCOPES = ['drive:read', 'drive:propose', 'drive:write'] as const satisfies readonly AgentScope[];
/** Standard identity scopes the OAuth provider also offers. */
export const OAUTH_IDENTITY_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

export const scopeLevel = (s: AgentScope): number => AGENT_SCOPES.indexOf(s);
export const scopeAllows = (have: AgentScope, need: AgentScope): boolean => scopeLevel(have) >= scopeLevel(need);

export function isAgentScope(s: string): s is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(s);
}

/** The highest drive scope in a space-separated scope list, or null when it has none. */
export function highestScope(scopeString: string): AgentScope | null {
  let best: AgentScope | null = null;
  for (const s of scopeString.split(/\s+/)) {
    if (isAgentScope(s) && (best === null || scopeLevel(s) > scopeLevel(best))) best = s;
  }
  return best;
}

/** Every drive scope up to and including `s`: 'drive:propose' → ['drive:read', 'drive:propose']. */
export function scopesUpTo(s: AgentScope): AgentScope[] {
  return AGENT_SCOPES.slice(0, scopeLevel(s) + 1);
}

/** Only drive:write may apply changes directly; read and propose always go through review. */
export function effectiveMode(scope: AgentScope, mode: AgentMode): AgentMode {
  return scope === 'drive:write' ? mode : 'review';
}

export const SCOPE_COPY: Record<AgentScope, { title: string; line: string }> = {
  'drive:read': { title: 'Read only', line: 'See your files, folders, versions and history.' },
  'drive:propose': { title: 'Suggest changes', line: 'Read, and propose changes that wait for your review.' },
  'drive:write': { title: 'Make changes', line: 'Read, and change files: write, move, delete, restore and undo.' },
};

export const MODE_COPY: Record<AgentMode, { title: string; line: string }> = {
  review: { title: 'Changes need my review', line: 'Every change waits in Proposals until you accept it.' },
  direct: { title: 'Apply directly', line: 'Changes land in your drive right away. Each one can be undone.' },
};
