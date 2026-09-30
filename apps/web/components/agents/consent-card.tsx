'use client';

// The OAuth consent card (MCP.md §14.5): who is asking, where the code goes, and what the app
// may do (access ≤ requested, mode, workspace). Allow / Deny post the decision and follow the
// provider's redirect back to the app.
import { useEffect, useState } from 'react';
import { Bot, CircleAlert } from 'lucide-react';
import type { AgentScope, OAuthConsentInfo } from '@volumes/shared';
import { Mark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { AccessOptions, WorkspacePicker, normalizeAccess, scopeAtMost, type AccessValue } from './access-options';

export const START_AGAIN = 'Start again from your app.';

/** The link still carries a live provider signature (`sig`, and `exp` in the future). */
export function signedQueryUsable(params: URLSearchParams, now = Date.now()): boolean {
  if (!params.get('sig')) return false;
  const exp = Number(params.get('exp'));
  return !(Number.isFinite(exp) && exp > 0 && exp * 1000 < now);
}

function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-del-fg">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Initial choices: the existing grant's (clamped to what is requested now), else the requested level in review mode on the default workspace. */
export function initialChoice(info: OAuthConsentInfo): { access: AccessValue; workspaceId: string | null } {
  const max: AgentScope = info.requested.scope;
  if (info.existing) {
    const scope = scopeAtMost(info.existing.scope, max) ? info.existing.scope : max;
    const ws = info.existing.workspaceId && !info.workspaces.some((w) => w.id === info.existing!.workspaceId) ? null : info.existing.workspaceId;
    return { access: normalizeAccess({ scope, mode: info.existing.mode }), workspaceId: ws };
  }
  const def = info.workspaces.find((w) => w.isDefault) ?? info.workspaces[0];
  return { access: { scope: max, mode: 'review' }, workspaceId: def ? def.id : null };
}

function errorText(e: unknown): string {
  if (isApiError(e) && e.status === 404) return `This app is not registered anymore. ${START_AGAIN}`;
  if (isApiError(e) && e.status === 400) return e.message.includes('expired') ? e.message : `${e.message} ${START_AGAIN}`;
  if (isApiError(e) && e.status === 0) return "Can't reach the server. Check your connection and try again.";
  return e instanceof Error && e.message ? `${e.message} ${START_AGAIN}` : `Something went wrong. ${START_AGAIN}`;
}

export function ConsentCard({ oauthQuery }: { oauthQuery: string }) {
  const [info, setInfo] = useState<OAuthConsentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessValue>({ scope: 'drive:read', mode: 'review' });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setLoadError(null);
    api.agents
      .consentInfo(oauthQuery)
      .then((i) => {
        if (!live) return;
        const init = initialChoice(i);
        setAccess(init.access);
        setWorkspaceId(init.workspaceId);
        setInfo(i);
      })
      .catch((e) => live && setLoadError(errorText(e)));
    return () => {
      live = false;
    };
  }, [oauthQuery]);

  const decide = async (accept: boolean) => {
    if (busy) return;
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const res = await api.agents.consent(
        accept ? { oauth_query: oauthQuery, accept, scope: access.scope, mode: access.mode, workspaceId } : { oauth_query: oauthQuery, accept },
      );
      window.location.assign(res.redirectUri);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em] text-vx-text-1">Connect an app to Volumes</h1>
        <ErrorRow>{loadError}</ErrorRow>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="skeleton block h-12 w-12 !rounded-full" />
        <span className="skeleton block h-6 w-3/4" />
        <span className="skeleton block h-16 w-full" />
        <span className="skeleton block h-16 w-full" />
      </div>
    );
  }

  const name = info.client.name;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <span aria-hidden className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-vx-accent-wash text-vx-on-accent-wash">
          <Bot size={24} strokeWidth={1.75} />
        </span>
        <h1 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em] text-vx-text-1">Connect {name} to Volumes</h1>
        <p className="vx-body mt-1 text-vx-text-3">
          {info.client.redirectHost ? <span className="font-mono text-[13px] text-vx-text-2">{info.client.redirectHost}</span> : 'This app'} wants access
          to your drive
        </p>
        {info.client.uri ? <p className="vx-meta mt-1 break-all font-mono text-vx-text-3">{info.client.uri}</p> : null}
        {info.existing ? <p className="vx-meta mt-2 text-vx-text-2">You connected this app before. Allowing again replaces its access.</p> : null}
      </div>
      <AccessOptions value={access} onChange={setAccess} maxScope={info.requested.scope} />
      <WorkspacePicker workspaces={info.workspaces} value={workspaceId} onChange={setWorkspaceId} />
      {error ? <ErrorRow>{error}</ErrorRow> : null}
      <div className="flex items-center justify-end gap-2 max-[720px]:flex-col-reverse max-[720px]:items-stretch">
        <Button variant="text" size="lg" onClick={() => void decide(false)} loading={busy === 'deny'} disabled={!!busy}>
          Deny
        </Button>
        <Button variant="primary" size="lg" onClick={() => void decide(true)} loading={busy === 'allow'} disabled={!!busy}>
          Allow
        </Button>
      </div>
      <p className="vx-micro text-vx-text-3">You can disconnect it any time in Settings → AI agents. Volumes never shares your password with apps.</p>
    </div>
  );
}

/** The page shell of /oauth/*: the sign-in card look (r24, 520 wide) centred on surface-2, the mark above. */
export function OAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center overflow-auto bg-vx-surface-2 px-4 py-10 max-[720px]:p-0">
      <main className="my-auto w-full max-w-[520px] rounded-[24px] border border-vx-hair bg-vx-surface p-8 shadow-vx-1 max-[720px]:min-h-dvh max-[720px]:rounded-none max-[720px]:border-0 max-[720px]:px-4 max-[720px]:py-8 max-[720px]:shadow-none">
        <div className="mb-6 flex items-center gap-2">
          <Mark size={28} />
          <span className="text-[16px] font-semibold leading-6 tracking-[-0.02em] text-vx-text-1">Volumes</span>
        </div>
        {children}
      </main>
    </div>
  );
}

export default ConsentCard;
