'use client';

// Sign-in (UNIFY-SPEC §14.1): one 960 card on the landing's atmosphere. Left: the metal KDRIVE
// lockup, the headline and the static voxel art. Right: one outline button per configured
// provider (labels come from config, never hard-coded), the dev-only email block, inline
// errors (no toasts), and `?next=` honoured. Footer: retention copy + the sun/moon toggle.
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { CircleAlert, KeyRound } from 'lucide-react';
import { RETENTION_COPY } from '@volumes/shared';
import { AuthCard, AuthFrame } from '@/components/auth/auth-frame';
import { SignInArt } from '@/components/auth/sign-in-art';
import { BrandMetal } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useConfig, useMe } from '@/lib/api/hooks';
import { authClient } from '@/lib/auth-client';

/** Only same-origin relative paths are honoured as `?next=`. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/signin')) return '/drive';
  return raw;
}

/** A provider's display label, derived from its configured id (e.g. "acme" → "Acme"). */
function providerLabel(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

/** Inline error copy for a failed sign-in call. */
function signInError(e: unknown, fallback: string): string {
  if (isApiError(e) && (e.status === 429 || e.code === 'rate_limited')) return 'Too many sign-in attempts. Try again in a minute.';
  if (isApiError(e) && e.status === 0) return "Can't reach the server. Check your connection and try again.";
  return e instanceof Error && e.message ? e.message : fallback;
}

function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { data: config, error: configError } = useConfig();
  const { data: me, error: meError } = useMe();
  const [email, setEmail] = useState('dev@volumes.local');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get('error') ? 'Sign-in was cancelled or failed. Try again.' : null);

  // Only a session the server still accepts leaves this page: a cached identity next to a
  // 401 is a session that already ended.
  const signedIn = !!me && !meError;
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  const social = async (provider: NonNullable<typeof config>['providers'][number]) => {
    setBusy(provider);
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await authClient().signIn.social({
        provider,
        callbackURL: `${origin}${next}`,
        errorCallbackURL: `${origin}/signin?error=oauth&next=${encodeURIComponent(next)}`,
      });
      if (res?.error) throw new Error(res.error.message || 'Could not start sign-in.');
    } catch (e) {
      setError(signInError(e, 'Could not start sign-in.'));
      setBusy(null);
    }
  };

  const dev = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('dev');
    setError(null);
    try {
      await api.auth.devSignIn(email.trim());
      await mutate('me', undefined, { revalidate: true });
      router.replace(next);
    } catch (err) {
      setError(signInError(err, 'Dev sign-in failed.'));
      setBusy(null);
    }
  };

  const providers = config?.providers ?? [];
  const nothing = config && providers.length === 0 && !config.devLogin;

  return (
    <AuthFrame>
      <AuthCard className="grid max-w-[960px] grid-cols-[1.1fr_1fr] max-[860px]:grid-cols-1">
        <section className="flex flex-col border-r border-vx-hair bg-vx-bg-2 p-10 max-[860px]:border-b max-[860px]:border-r-0 max-[720px]:min-h-[140px] max-[720px]:justify-center max-[720px]:px-6 max-[720px]:py-7">
          <BrandMetal />
          <div className="vx-eyebrow mt-10 max-[860px]:mt-6 max-[720px]:hidden">Versioned cloud drive</div>
          <h1 className="vx-display mt-3 max-[720px]:mt-5 max-[720px]:text-[30px] max-[720px]:leading-[34px]">
            Every change
            <br />
            is a <span className="vx-metal">version.</span>
          </h1>
          <p className="vx-body-lg mt-4 max-w-[420px] text-vx-text-2 max-[860px]:hidden">
            The drive that remembers: travel back, compare, restore — and undo the restore.
          </p>
          <div className="mt-auto flex justify-center pt-12 max-[860px]:hidden">
            <SignInArt />
          </div>
        </section>

        <section className="flex items-center justify-center p-10 max-[720px]:items-start max-[720px]:px-6 max-[720px]:py-8">
          <div className="w-full max-w-[360px]">
            <h2 className="vx-h1">Sign in</h2>
            <p className="vx-meta mt-1 text-vx-text-3">to continue to your drive</p>

            <div className="mt-8 flex flex-col gap-3">
              {!config && !configError ? (
                <>
                  <span className="skeleton block h-11 w-full !rounded-vx-sm" />
                  <span className="skeleton block h-11 w-full !rounded-vx-sm" />
                </>
              ) : null}
              {providers.map((p) => (
                <Button
                  key={p}
                  size="lg"
                  variant="outline"
                  block
                  icon={<KeyRound size={16} strokeWidth={1.75} aria-hidden />}
                  onClick={() => social(p)}
                  loading={busy === p}
                  disabled={!!busy}
                >
                  Continue with {providerLabel(p)}
                </Button>
              ))}
            </div>

            {config?.devLogin ? (
              <>
                {providers.length ? (
                  <div className="my-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[.14em] text-vx-text-3" aria-hidden>
                    <span className="h-px flex-1 bg-vx-hair" />
                    or
                    <span className="h-px flex-1 bg-vx-hair" />
                  </div>
                ) : null}
                <form onSubmit={dev} className="rounded-vx-md border border-dashed border-vx-hair-dash p-4">
                  <div className="vx-eyebrow mb-3">Dev only</div>
                  <Input
                    size="lg"
                    id="dev-email"
                    label="Email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                  <Button variant="primary" size="lg" block type="submit" className="mt-4" loading={busy === 'dev'} disabled={!!busy && busy !== 'dev'}>
                    Continue with dev account
                  </Button>
                </form>
              </>
            ) : null}

            {nothing ? (
              <ErrorRow>
                No sign-in method is configured. Set a provider&apos;s client id and secret, or VOLUMES_DEV_LOGIN=1 for local development.
              </ErrorRow>
            ) : null}
            {configError ? <ErrorRow>Can&apos;t reach the server right now. Reload the page in a moment.</ErrorRow> : null}
            {error ? <ErrorRow>{error}</ErrorRow> : null}
          </div>
        </section>
      </AuthCard>

      <footer className="relative z-[1] mt-5 flex w-full max-w-[960px] items-center justify-between gap-4 max-[720px]:mt-0 max-[720px]:bg-vx-surface max-[720px]:px-6 max-[720px]:pb-6">
        <p className="vx-micro text-vx-text-3">{RETENTION_COPY}</p>
        <ThemeToggle size="sm" />
      </footer>
    </AuthFrame>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}
