'use client';

// Sign-in (DESIGN-v2 §6.1): one centred two-column card on surface-2. Left: the mark, the
// headline and a static illustration. Right: one outline button per configured provider
// (labels come from config, never hard-coded), the dev-only email block, inline errors
// (no toasts), and `?next=` honoured. Footer: retention copy + Light / Dark / System.
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { CircleAlert, KeyRound } from 'lucide-react';
import { RETENTION_COPY } from '@volumes/shared';
import { Mark } from '@/components/shell/brand';
import { ThemeSegmented } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
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
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-del-fg">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Three fanned sheets with added and removed lines over a dot timeline: one past (amber) dot, one "now" (blue) dot. Static. */
function SignInArt() {
  const Sheet = ({ rotate, x, y, lines }: { rotate: number; x: number; y: number; lines: ('add' | 'del' | 'plain')[] }) => (
    <g transform={`translate(${x} ${y}) rotate(${rotate} 70 90)`}>
      <rect width="140" height="180" rx="12" fill="var(--vx-surface)" stroke="var(--vx-hair)" strokeWidth="1.5" />
      <rect x="16" y="18" width="60" height="8" rx="4" fill="var(--vx-surface-3)" />
      {lines.map((l, i) => (
        <rect
          key={i}
          x="16"
          y={42 + i * 20}
          width={l === 'plain' ? 96 - (i % 2) * 24 : 108}
          height="10"
          rx="5"
          fill={l === 'add' ? 'var(--vx-add-word)' : l === 'del' ? 'var(--vx-del-word)' : 'var(--vx-surface-3)'}
        />
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 420 300" className="h-auto w-full max-w-[420px]" aria-hidden>
      <Sheet rotate={-6} x={40} y={20} lines={['plain', 'del', 'plain', 'plain', 'plain', 'plain']} />
      <Sheet rotate={-1} x={140} y={10} lines={['plain', 'plain', 'add', 'plain', 'del', 'plain']} />
      <Sheet rotate={4} x={240} y={24} lines={['plain', 'add', 'add', 'plain', 'plain', 'plain']} />
      <line x1="30" y1="262" x2="390" y2="262" stroke="var(--vx-hair-strong)" strokeWidth="2" strokeLinecap="round" />
      {[60, 100, 140, 210, 250, 290, 330].map((cx) => (
        <circle key={cx} cx={cx} cy="262" r="4" fill="var(--vx-tick)" stroke="var(--vx-surface)" strokeWidth="2" />
      ))}
      <circle cx="170" cy="262" r="10" fill="var(--vx-past-halo)" />
      <circle cx="170" cy="262" r="6" fill="var(--vx-past-dot)" />
      <circle cx="372" cy="262" r="11" fill="var(--vx-accent-wash)" />
      <circle cx="372" cy="262" r="7" fill="var(--vx-accent)" />
    </svg>
  );
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { data: config, error: configError } = useConfig();
  const { data: me } = useMe();
  const [email, setEmail] = useState('dev@volumes.local');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get('error') ? 'Sign-in was cancelled or failed. Try again.' : null);

  useEffect(() => {
    if (me) router.replace(next);
  }, [me, next, router]);

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
    <div className="flex h-dvh flex-col items-center overflow-auto bg-vx-surface-2 px-4 py-10 max-[720px]:p-0">
      <div className="my-auto grid w-full max-w-[1000px] grid-cols-[1.1fr_1fr] overflow-hidden rounded-[24px] border border-vx-hair bg-vx-surface shadow-vx-1 max-[860px]:grid-cols-1 max-[720px]:rounded-none max-[720px]:border-0 max-[720px]:shadow-none">
        <section
          className="flex flex-col p-10 max-[860px]:min-h-[160px] max-[860px]:justify-center max-[720px]:px-6 max-[720px]:py-8"
          style={{ background: 'linear-gradient(180deg, var(--vx-surface) 0%, color-mix(in srgb, var(--vx-accent-wash) 55%, var(--vx-surface)) 100%)' }}
        >
          <div className="flex items-center gap-2.5">
            <Mark size={40} />
            <span className="text-[20px] font-semibold leading-7 tracking-[-0.02em] text-vx-text-1">Volumes</span>
          </div>
          <h1 className="vx-display mt-10 max-[860px]:mt-6">
            Every change
            <br />
            is a version.
          </h1>
          <p className="vx-body-lg mt-4 max-w-[420px] text-vx-text-2 max-[860px]:hidden">
            A personal drive you can scroll back through time, compare, restore and share.
          </p>
          <div className="mt-auto flex justify-center pt-10 max-[860px]:hidden">
            <SignInArt />
          </div>
        </section>

        <section className="flex items-center justify-center p-10 max-[720px]:px-6 max-[720px]:py-8">
          <div className="w-full max-w-[360px]">
            <h2 className="vx-h1">Sign in</h2>
            <p className="vx-body mt-1 text-vx-text-3">to continue to your drive</p>

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
                  icon={<KeyRound size={18} strokeWidth={1.75} aria-hidden />}
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
                  <div className="my-6 flex items-center gap-3 text-[13px] text-vx-text-3" aria-hidden>
                    <span className="h-px flex-1 bg-vx-hair" />
                    or
                    <span className="h-px flex-1 bg-vx-hair" />
                  </div>
                ) : null}
                <form onSubmit={dev} className="rounded-vx-md border border-dashed border-vx-hair-dash p-4">
                  <Badge tone="dashed" className="mb-3">
                    Dev only
                  </Badge>
                  <Input
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
      </div>

      <footer className="mt-6 flex w-full max-w-[1000px] items-center justify-between gap-4 max-[720px]:px-6 max-[720px]:pb-6">
        <p className="vx-micro text-vx-text-3">{RETENTION_COPY}</p>
        <ThemeSegmented iconsOnly />
      </footer>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}
