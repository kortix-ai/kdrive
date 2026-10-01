'use client';

// Settings → AI agents, block 3: agent tokens (rows, New token, Revoke with an inline confirm).
import { useState } from 'react';
import { format } from 'date-fns';
import { mutate } from 'swr';
import { Ellipsis, KeyRound, Plus } from 'lucide-react';
import type { AgentToken } from '@volumes/shared';
import { Section, SectionError } from '@/components/settings/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { api } from '@/lib/api/endpoints';
import { useAgentTokens } from '@/lib/api/hooks';
import { formatRelative, isoTitle } from '@/lib/format';
import { AccessBadges } from './access-options';
import { TokenDialog } from './token-dialog';

/** "30 Sep 2027" */
export const dayLabel = (iso: string) => format(new Date(iso), 'd MMM yyyy');

/** "used 5 min ago", "used today 09:12", "never used". */
export function usedLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'never used';
  const r = formatRelative(iso, now);
  return `used ${/^(Just|Today|Yesterday)/.test(r) ? r.charAt(0).toLowerCase() + r.slice(1) : r}`;
}

/** Inline danger confirm (r6, danger wash + edge inset): question, consequence, Keep + the danger action. */
export function DangerConfirm({
  question,
  detail,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  question: string;
  detail?: string;
  action: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-vx-md bg-vx-danger-wash px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--vx-danger-edge)]">
      <div className="min-w-0 flex-[1_1_220px]">
        <div className="text-[14px] font-semibold leading-5 text-vx-text-1">{question}</div>
        {detail ? <div className="mt-0.5 text-[13px] leading-5 text-vx-text-2">{detail}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="text" disabled={busy} onClick={onCancel}>
          Keep
        </Button>
        <Button size="sm" variant="danger" loading={busy} onClick={onConfirm}>
          {action}
        </Button>
      </div>
    </div>
  );
}

function TokenRow({ token }: { token: AgentToken }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dead = !!token.revokedAt || token.expired;

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.agents.revokeToken(token.id);
      setConfirming(false);
      await mutate('agent-tokens');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not revoke the token.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="-mx-3 border-t border-vx-hair-soft px-3 py-3 transition-colors duration-[120ms] first:border-t-0 hover:bg-vx-raise" data-token-id={token.id}>
      <div className="flex min-h-8 items-center gap-3">
        <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-2 text-vx-text-2">
          <KeyRound size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cx('truncate text-[14px] font-medium leading-5', dead ? 'text-vx-text-3' : 'text-vx-text-1')}>{token.name}</span>
            <AccessBadges scope={token.scope} mode={token.mode} workspaceId={token.workspaceId} workspaceName={token.workspaceName} />
            {token.revokedAt ? <Badge tone="dashed">Revoked</Badge> : token.expired ? <Badge tone="dashed">Expired</Badge> : null}
          </div>
          <div className="vx-meta mt-0.5 truncate text-vx-text-3">
            <span>{token.prefix}…</span> · {token.expired ? 'expired' : 'expires'}{' '}
            <span title={isoTitle(token.expiresAt)}>{dayLabel(token.expiresAt)}</span> ·{' '}
            <span title={token.lastUsedAt ? isoTitle(token.lastUsedAt) : undefined}>{usedLabel(token.lastUsedAt)}</span>
          </div>
        </div>
        {!dead ? (
          <Menu
            align="end"
            items={[{ id: 'revoke', label: 'Revoke', danger: true, onSelect: () => setConfirming(true) }]}
            trigger={(p) => (
              <IconButton {...p} size="sm" label={`Actions for ${token.name}`} className="max-[720px]:h-11 max-[720px]:w-11">
                <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
              </IconButton>
            )}
          />
        ) : null}
      </div>
      {confirming ? (
        <DangerConfirm
          question={`Revoke ${token.name}?`}
          detail="Anything using it stops working now."
          action="Revoke"
          busy={busy}
          onConfirm={() => void revoke()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {error ? (
        <div className="mt-2">
          <SectionError>{error}</SectionError>
        </div>
      ) : null}
    </li>
  );
}

/** Agent tokens: New token (dialog, secret shown once) and the list, revoked and expired rows dimmed. */
export function TokenList() {
  const { data, error } = useAgentTokens();
  const [creating, setCreating] = useState(false);
  const tokens = data?.tokens;
  return (
    <Section
      id="agents-tokens"
      label="Agent tokens"
      description="For scripts and agents that cannot sign in. A token has the access you choose and expires within a year."
      aside={
        <Button variant="outline" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setCreating(true)}>
          New token
        </Button>
      }
    >
      {error && !tokens ? (
        <SectionError>Can&apos;t load your tokens right now.</SectionError>
      ) : !tokens ? (
        <div className="flex flex-col gap-2">
          <span className="skeleton block h-10 w-full" />
          <span className="skeleton block h-10 w-full" />
        </div>
      ) : tokens.length === 0 ? (
        <p className="vx-body text-vx-text-3">No tokens.</p>
      ) : (
        <ul className="flex flex-col" aria-label="Agent tokens">
          {tokens.map((t) => (
            <TokenRow key={t.id} token={t} />
          ))}
        </ul>
      )}
      <TokenDialog open={creating} onClose={() => setCreating(false)} />
    </Section>
  );
}

export default TokenList;
