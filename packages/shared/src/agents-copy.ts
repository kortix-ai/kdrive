import type { AgentMode, AgentScope } from './schemas/agents';

/** User-facing words for agent access levels (the API's scopes.ts holds the same text). */
export const SCOPE_COPY: Record<AgentScope, { title: string; line: string }> = {
  'drive:read': { title: 'Read only', line: 'See your files, folders, versions and history.' },
  'drive:propose': { title: 'Suggest changes', line: 'Read, and propose changes that wait for your review.' },
  'drive:write': { title: 'Make changes', line: 'Read, and change files: write, move, delete, restore and undo.' },
};

/** User-facing words for what happens to an agent's changes. */
export const MODE_COPY: Record<AgentMode, { title: string; line: string }> = {
  review: { title: 'Changes need my review', line: 'Every change waits in Proposals until you accept it.' },
  direct: { title: 'Apply directly', line: 'Changes land in your drive right away. Each one can be undone.' },
};
