'use client';

// The OAuth consent card (MCP.md §14.5): who is asking, where the code goes, and what the app
// may do (access ≤ requested, mode, workspace). Allow / Deny post the decision and follow the
// provider's redirect back to the app.
import { useEffect, useState } from 'react';
import { Bot, CircleAlert } from 'lucide-react';
import type { AgentScope, OAuthConsentInfo } from '@volumes/shared';
import { AuthCard, AuthFrame } from '@/components/auth/auth-frame';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
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
    <p role="alert" className="flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Initial choices: the existing grant's (clamped to what is requested now). Otherwise at most
 * "Suggest changes" in review mode on the default workspace: most apps ask for every scope,
 * so more than suggesting is something the user picks, never the default.
 */
export function initialChoice(info: OAuthConsentInfo): { access: AccessValue; workspaceId: string | null } {
  const max: AgentScope = info.requested.scope;
  if (info.existing) {
    const scope = scopeAtMost(info.existing.scope, max) ? info.existing.scope : max;
    const ws = info.existing.workspaceId && !info.workspaces.some((w) => w.id === info.existing!.workspaceId) ? null : info.existing.workspaceId;
    return { access: normalizeAccess({ scope, mode: info.existing.mode }), workspaceId: ws };
  }
  const def = info.workspaces.find((w) => w.isDefault) ?? info.workspaces[0];
  const scope: AgentScope = scopeAtMost('drive:propose', max) ? 'drive:propose' : max;
  return { access: { scope, mode: 'review' }, workspaceId: def ? def.id : null };
}

/** Plain sentences only: a validator's message (`oauth_query: Invalid input…`) is never shown. */
export function errorText(e: unknown): string {
  if (isApiError(e) && e.status === 404) return `This app is not registered anymore. ${START_AGAIN}`;
  if (isApiError(e) && e.status === 400) {
    return /expired/i.test(e.message) ? `This sign-in link expired. ${START_AGAIN}` : `This sign-in link is incomplete or out of date. ${START_AGAIN}`;
  }
  if (isApiError(e) && e.status === 0) return "Can't reach the server. Check your connection and try again.";
  return `Something went wrong. ${START_AGAIN}`;
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
        <h1 className="vx-h2">Connect an app to KDRIVE</h1>
        <ErrorRow>{loadError}</ErrorRow>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="skeleton block h-10 w-10 !rounded-vx-sm" />
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
        <span aria-hidden className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-3 text-vx-text-1">
          <Bot size={20} strokeWidth={1.75} />
        </span>
        <h1 className="vx-h2">Connect {name} to KDRIVE</h1>
        <p className="vx-body mt-1 text-vx-text-3">
          {info.client.redirectHost ? <span className="font-mono text-[12.5px] text-vx-text-2">{info.client.redirectHost}</span> : 'This app'} wants access
          to your drive
        </p>
        {info.client.uri ? <p className="vx-meta mt-1 break-all text-vx-text-3">{info.client.uri}</p> : null}
        {info.existing ? <p className="vx-body mt-2 text-vx-text-2">You connected this app before. Allowing again replaces its access.</p> : null}
      </div>
      <AccessOptions value={access} onChange={setAccess} maxScope={info.requested.scope} />
      <WorkspacePicker workspaces={info.workspaces} value={workspaceId} onChange={setWorkspaceId} />
      {error ? <ErrorRow>{error}</ErrorRow> : null}
      <div className="flex items-center justify-end gap-2 max-[720px]:flex-col-reverse max-[720px]:items-stretch">
        <Button variant="outline" size="lg" onClick={() => void decide(false)} loading={busy === 'deny'} disabled={!!busy}>
          Deny
        </Button>
        <Button variant="primary" size="lg" onClick={() => void decide(true)} loading={busy === 'allow'} disabled={!!busy}>
          Allow
        </Button>
      </div>
      <p className="vx-micro text-vx-text-3">You can disconnect it any time in Settings → AI agents. KDRIVE never shares your password with apps.</p>
    </div>
  );
}

/**
 * The page shell of /oauth/* (UNIFY-SPEC §14.1): one card (440 to sign in, 520 for consent) on the landing's
 * atmosphere, the flat KDRIVE lockup at its top, the sun/moon toggle under it.
 */
export function OAuthShell({ children, width = 520 }: { children: React.ReactNode; width?: number }) {
  return (
    <AuthFrame>
      <AuthCard className="p-8 max-[720px]:max-w-none max-[720px]:px-5 max-[720px]:py-7" style={{ maxWidth: width }}>
        <main>
          {/* The theme switch rides in the card's brand row, not loose under the card. */}
          <div className="mb-7 flex items-center justify-between gap-3">
            <Brand href={null} />
            <ThemeToggle size="sm" className="-mr-1.5" />
          </div>
          {children}
        </main>
      </AuthCard>
    </AuthFrame>
  );
}

export default ConsentCard;
