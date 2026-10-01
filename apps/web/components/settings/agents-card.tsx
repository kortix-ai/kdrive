'use client';

// Settings: the AI agents card. A short summary and a link to Settings → AI agents.
import Link from 'next/link';
import { Bot, ChevronRight } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { useAgentTokens, useConfig, useConnectedApps } from '@/lib/api/hooks';
import { Section } from './section';

/** "2 connected apps · 1 active token" (or the off / empty line). */
export function agentsSummary(apps: number | null, tokens: number | null): string {
  if (apps === null || tokens === null) return '';
  if (!apps && !tokens) return 'No agents connected yet.';
  const a = apps === 1 ? '1 connected app' : `${apps} connected apps`;
  const t = tokens === 1 ? '1 active token' : `${tokens} active tokens`;
  return `${a} · ${t}`;
}

export function AgentsCard() {
  const { data: config } = useConfig();
  const { data: apps } = useConnectedApps();
  const { data: tokens } = useAgentTokens();
  const active = tokens ? tokens.tokens.filter((t) => !t.revokedAt && !t.expired).length : null;
  const off = config && !config.mcp.enabled;
  return (
    <Section
      id="agents"
      label="AI agents"
      description={
        off
          ? 'AI agent access is turned off on this server.'
          : 'Let AI agents read your drive and suggest or make changes, with the access you choose.'
      }
      aside={
        <Link href="/settings/agents" className={buttonClass('outline', 'md', { withIcon: true })}>
          <Bot size={18} strokeWidth={1.75} aria-hidden />
          Manage
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="-mr-1" />
        </Link>
      }
    >
      {!off && apps && active !== null ? (
        <p className="vx-meta text-vx-text-3">{agentsSummary(apps.apps.length, active)}</p>
      ) : null}
    </Section>
  );
}

export default AgentsCard;
