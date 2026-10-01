'use client';

// /oauth/sign-in: sign in to continue an app's authorization. Every call goes through the
// OAuth auth client, which sends the provider's signed query along so the authorization
// continues (to /oauth/consent) once the session exists.
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CircleAlert, KeyRound } from 'lucide-react';
import { OAuthShell, START_AGAIN, signedQueryUsable } from '@/components/agents/consent-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/lib/api/hooks';
import { oauthAuthClient } from '@/lib/oauth-auth-client';

const label = (id: string) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);

function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function follow(data: unknown): boolean {
  const d = data as { url?: unknown; redirect?: unknown } | null;
  if (d && typeof d.url === 'string' && d.url) {
    window.location.assign(d.url);
    return true;
  }
  return false;
}

function SignIn() {
  const params = useSearchParams();
  const usable = signedQueryUsable(params);
  const { data: config, error: configError } = useConfig();
  const [email, setEmail] = useState('dev@volumes.local');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const social = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try {
      const res = await oauthAuthClient().signIn.social({ provider, callbackURL: '/oauth/consent' });
      if (res?.error) throw new Error(res.error.message || 'Could not start sign-in.');
      follow(res?.data);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not start sign-in.');
      setBusy(null);
    }
  };

  const dev = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('dev');
    setError(null);
    try {
      const res = await oauthAuthClient().$fetch('/dev/sign-in', { method: 'POST', body: { email: email.trim() } });
      if (res.error) throw new Error(res.error.message || 'Dev sign-in failed.');
      if (!follow(res.data)) window.location.assign(`/oauth/consent${window.location.search}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Dev sign-in failed.');
      setBusy(null);
    }
  };

  const providers = config?.providers ?? [];
  return (
    <OAuthShell width={440}>
      <h1 className="vx-h2">Sign in to connect an app</h1>
      <p className="vx-body mt-1 text-vx-text-3">An app wants to use your KDRIVE drive. You&apos;ll choose what it can do next.</p>
      {!usable ? (
        <ErrorRow>This link expired. {START_AGAIN}</ErrorRow>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {!config && !configError ? <span className="skeleton block h-11 w-full !rounded-vx-sm" /> : null}
            {providers.map((p) => (
              <Button
                key={p}
                size="lg"
                variant="outline"
                block
                icon={<KeyRound size={16} strokeWidth={1.75} aria-hidden />}
                onClick={() => void social(p)}
                loading={busy === p}
                disabled={!!busy}
              >
                Continue with {label(p)}
              </Button>
            ))}
          </div>
          {config?.devLogin ? (
            <form onSubmit={dev} className="mt-4 rounded-vx-md border border-dashed border-vx-hair-dash p-4">
              <div className="vx-eyebrow mb-3">Dev only</div>
              <Input size="lg" id="dev-email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <Button variant="primary" size="lg" block type="submit" className="mt-4" loading={busy === 'dev'} disabled={!!busy && busy !== 'dev'}>
                Continue with dev account
              </Button>
            </form>
          ) : null}
          {config && !providers.length && !config.devLogin ? <ErrorRow>No sign-in method is configured on this server.</ErrorRow> : null}
          {configError ? <ErrorRow>Can&apos;t reach the server right now. Reload the page in a moment.</ErrorRow> : null}
          {error ? <ErrorRow>{error}</ErrorRow> : null}
        </>
      )}
    </OAuthShell>
  );
}

export default function OAuthSignInPage() {
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}
