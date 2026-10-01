'use client';

// New agent token (480): step 1 chooses name, access, mode, workspace and expiry; step 2 shows
// the secret once. The secret lives only in this component's state and is dropped on close:
// never in SWR, the store, storage or the URL.
import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { CircleAlert } from 'lucide-react';
import { AGENT_TOKEN_EXPIRY_DAYS, type AgentToken } from '@volumes/shared';
import { CopyButton } from '@/components/share/copy-button';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useConfig } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { AccessOptions, WorkspacePicker, type AccessValue } from './access-options';
import { mcpConfigSnippet, Snippet } from './connect-section';

type Expiry = (typeof AGENT_TOKEN_EXPIRY_DAYS)[number];
const EXPIRY_LABEL: Record<Expiry, string> = { 30: '30 days', 90: '90 days', 365: '1 year' };

export const TOKEN_NAME_MAX = 60;

/** Inline message for an invalid name, or null. */
export function tokenNameError(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  if (n.length > TOKEN_NAME_MAX) return `Use at most ${TOKEN_NAME_MAX} characters.`;
  return null;
}

const INITIAL: AccessValue = { scope: 'drive:propose', mode: 'review' };

export function TokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useVx((s) => s.me);
  const { data: config } = useConfig();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<AccessValue>(INITIAL);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<Expiry>(365);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: AgentToken; secret: string } | null>(null);
  /** The secret was copied (a Copy button, or a copy from the field). */
  const [copied, setCopied] = useState(false);
  /** Closing was asked for before anything was copied: the next close goes through. */
  const [leaving, setLeaving] = useState(false);

  // Every opening starts clean, and closing forgets the secret.
  useEffect(() => {
    if (open) return;
    setName('');
    setAccess(INITIAL);
    setWorkspaceId(null);
    setExpiry(365);
    setBusy(false);
    setError(null);
    setCreated(null);
    setCopied(false);
    setLeaving(false);
  }, [open]);

  const close = () => {
    setCreated(null);
    onClose();
  };

  const nameError = tokenNameError(name);
  const canCreate = !!name.trim() && !nameError && !busy;

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.agents.createToken({ name: name.trim(), scope: access.scope, mode: access.mode, workspaceId, expiresInDays: expiry });
      setCreated(res);
      void mutate('agent-tokens');
    } catch (e) {
      setError(
        isApiError(e, 'conflict')
          ? e.message
          : isApiError(e, 'not_found')
            ? 'That drive is no longer available. Choose another one.'
            : e instanceof Error && e.message
              ? e.message
              : 'Could not create the token.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const url = config?.mcp.url ?? `${typeof window === 'undefined' ? '' : window.location.origin}/mcp`;
    const didCopy = () => {
      setCopied(true);
      setLeaving(false);
    };
    // The secret cannot be shown again: a stray click on the scrim, Esc or ↵ never closes
    // this step, and closing before anything was copied asks once more.
    const done = () => {
      if (copied || leaving) close();
      else setLeaving(true);
    };
    return (
      <Dialog
        open={open}
        onClose={done}
        dismissible={false}
        title="Copy your token"
        description={created.token.name}
        footer={
          <Button variant={leaving ? 'danger' : 'primary'} onClick={done}>
            {leaving ? 'Close without copying' : 'Done'}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p
            role={leaving ? 'alert' : undefined}
            className={
              leaving
                ? 'flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger'
                : 'flex items-start gap-2 rounded-vx-sm bg-vx-surface-2 px-3 py-2 text-[13px] leading-5 text-vx-text-2'
            }
          >
            <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {leaving
                ? "You haven't copied the token. Once you close this, it can't be shown again."
                : "You won't see it again. Store it somewhere safe."}
            </span>
          </p>
          <div className="flex items-end gap-2">
            <Input
              label="Agent token"
              readOnly
              mono
              value={created.secret}
              onFocus={(e) => e.currentTarget.select()}
              onCopy={didCopy}
              className="min-w-0 flex-1"
              data-secret
            />
            <CopyButton text={created.secret} className="mb-[3px]" onCopied={didCopy} />
          </div>
          <Snippet label="MCP client configuration with this token" text={mcpConfigSnippet(url, created.secret)} onCopied={didCopy} />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New agent token"
      description="For scripts and agents that cannot sign in."
      onSubmit={() => void submit()}
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="text" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!canCreate}>
            Create token
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input
          label="Name"
          placeholder="Research agent"
          value={name}
          maxLength={TOKEN_NAME_MAX + 20}
          onChange={(e) => setName(e.target.value)}
          invalid={nameError ?? undefined}
          autoFocus
          required
        />
        <AccessOptions value={access} onChange={setAccess} />
        <WorkspacePicker workspaces={me?.workspaces ?? []} value={workspaceId} onChange={setWorkspaceId} />
        <div>
          <p className="mb-2 text-[13px] font-medium leading-5 text-vx-text-2">Expires</p>
          <Segmented<`${Expiry}`>
            label="Expires"
            value={`${expiry}`}
            onChange={(v) => setExpiry(Number(v) as Expiry)}
            options={AGENT_TOKEN_EXPIRY_DAYS.map((d) => ({ value: `${d}` as `${Expiry}`, label: EXPIRY_LABEL[d] }))}
          />
        </div>
      </div>
    </Dialog>
  );
}

export default TokenDialog;
