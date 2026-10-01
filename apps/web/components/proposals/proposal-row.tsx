'use client';

// One row of the proposals inbox (UNIFY-SPEC §14.4, §12.1): 56 h, full-bleed with a hair-soft divider; the whole row links to the review
// page. Line 1: the message (or a generated summary) and the time; line 2: the agent badge,
// count chips and the number of changes. Decided rows add their state badge.
import Link from 'next/link';
import { Bot } from 'lucide-react';
import type { ProposalSummary } from '@volumes/shared';
import { AgentBadge } from '@/components/agents/agent-badge';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { When } from '@/components/versioning/readout';
import { proposalHref } from '@/lib/urls';
import { countChips, countWord, proposalTitle, statusBadge } from './format';

/** The 32 px Bot tile in front of a proposal (r4, surface-2, hair). */
export function AgentDisc({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-2 text-vx-text-2', className)}
      style={{ width: size, height: size }}
    >
      <Bot size={size >= 40 ? 20 : 16} strokeWidth={1.75} />
    </span>
  );
}

export function ProposalRow({ proposal: p }: { proposal: ProposalSummary }) {
  const title = proposalTitle(p);
  const state = statusBadge(p.status);
  const chips = countChips(p.counts);
  const decided = p.status !== 'open';
  return (
    <Link
      href={proposalHref(p.id)}
      data-proposal={p.id}
      className={cx(
        'vx-inset-focus group flex min-h-14 items-center gap-3 px-3 py-2 transition-colors duration-[120ms] hover:bg-vx-raise max-[720px]:min-h-[60px]',
      )}
    >
      <AgentDisc className={decided ? 'opacity-70' : undefined} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className={cx('min-w-0 flex-1 truncate text-[14px] font-medium leading-5', decided ? 'text-vx-text-2' : 'text-vx-text-1')} title={title}>
            {title}
          </span>
          <When at={p.decidedAt ?? p.createdAt} className="vx-meta shrink-0 text-vx-text-3" />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <AgentBadge agent={p.agent} />
          {chips.map((c) => (
            <Badge key={c.key} tone={c.tone} title={c.title} className="font-mono !font-medium">
              {c.text}
            </Badge>
          ))}
          <span className="vx-meta whitespace-nowrap text-vx-text-3">· {countWord(p.opCount, 'file')}</span>
          {state ? (
            <Badge tone={state.tone} className="ml-auto" pip={p.status === 'accepted'}>
              {state.label}
            </Badge>
          ) : p.pending < p.opCount ? (
            <span className="vx-meta whitespace-nowrap text-vx-text-3">· {p.pending.toLocaleString('en-US')} waiting</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export default ProposalRow;
