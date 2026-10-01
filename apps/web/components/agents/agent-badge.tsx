'use client';

// "Agent" badge (UNIFY-SPEC §14.4): a neutral 20 px r2 badge with a 12 px Bot icon and the agent's
// name, marking changes an AI agent made (timeline, strip card, versions, proposals).
import { Bot } from 'lucide-react';
import type { AgentRef } from '@volumes/shared';
import { cx } from '@/components/ui/cx';

/** Longest name shown before the ellipsis; the tooltip always has the full name. */
export const AGENT_NAME_MAX = 24;

export function agentDisplayName(name: string): string {
  const n = name.trim() || 'AI agent';
  return n.length > AGENT_NAME_MAX ? `${n.slice(0, AGENT_NAME_MAX - 1).trimEnd()}…` : n;
}

/** "Changed by the AI agent Research bot (token)". */
export function agentTitle(agent: AgentRef): string {
  return `Changed by the AI agent ${agent.name.trim() || 'AI agent'} (${agent.kind === 'oauth' ? 'app' : 'token'})`;
}

export function AgentBadge({ agent, size = 'sm', className }: { agent: AgentRef; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      title={agentTitle(agent)}
      data-agent-badge=""
      className={cx(
        'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-vx-xs bg-vx-surface-3 px-1.5 font-sans font-semibold tracking-normal tabular-nums text-vx-text-2',
        size === 'md' ? 'h-6 text-[12px] leading-4' : 'h-5 text-[11px] leading-4',
        className,
      )}
    >
      <Bot size={12} strokeWidth={2} aria-hidden className="shrink-0" />
      <span className="sr-only">Agent: </span>
      <span className="truncate">{agentDisplayName(agent.name)}</span>
    </span>
  );
}

export default AgentBadge;
