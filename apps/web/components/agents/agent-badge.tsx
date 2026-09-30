'use client';

// Placeholder: "Agent" badge with the agent's name (built by its owner).
import type { AgentRef } from '@volumes/shared';

export function AgentBadge({ agent }: { agent: AgentRef; size?: 'sm' | 'md' }) {
  return <span className="vx-meta text-vx-text-2">{agent.name}</span>;
}

export default AgentBadge;
