'use client';

// Placeholder: access level + mode option cards, shared by the token dialog and consent (built by its owner).
import type { AgentMode, AgentScope } from '@volumes/shared';

export interface AccessValue {
  scope: AgentScope;
  mode: AgentMode;
}

export function AccessOptions(_props: { value: AccessValue; onChange: (v: AccessValue) => void; maxScope?: AgentScope }) {
  return <p className="vx-meta text-vx-text-3">Access options — coming soon.</p>;
}

export default AccessOptions;
