'use client';

// Sign in / create account (UNIFY-SPEC §14.1): one 960 card on the landing's atmosphere. Left: the
// metal KDRIVE lockup, the headline and the static voxel art. Right: one outline button per configured
// provider (labels come from config, never hard-coded), the email + password form, the dev-only email
// block, inline errors (no toasts), and `?next=` honoured across both modes. Footer: retention copy.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { KeyRound } from 'lucide-react';
import { PASSWORD_MAX, PASSWORD_MIN, RETENTION_COPY } from '@volumes/shared';
import { AuthCard, AuthFrame } from '@/components/auth/auth-frame';
import { ErrorRow, NoticeRow, OrRule, StrengthMeter, authErrorCopy, oauthErrorCopy, providerButtonLabel, safeNext } from '@/components/auth/auth-bits';
import { SignInArt } from '@/components/auth/sign-in-art';
import { BrandMetal } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/endpoints';
import { useConfig, useMeIfSignedIn } from '@/lib/api/hooks';
import { authClient } from '@/lib/auth-client';

export type AuthMode = 'signin' | 'signup';

/** Optional legal links for the sign-up line (NEXT_PUBLIC_TERMS_URL / NEXT_PUBLIC_PRIVACY_URL). */
const TERMS_URL = process.env.NEXT_PUBLIC_TERMS_URL || null;
const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || null;

function Legal({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-vx-text-2 underline underline-offset-2 hover:text-vx-text-1">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

const withNext = (path: string, next: string) => (next === '/drive' ? path : `${path}?next=${encodeURIComponent(next)}`);

export function SignInScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const signup = mode === 'signup';
  const { data: config, error: configError } = useConfig();
  const { data: me, error: meError } = useMeIfSignedIn();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [devEmail, setDevEmail] = useState('dev@volumes.local');
  const [busy, setBusy] = useState<string | null>(null);
  // A failed provider sign-in comes back with better-auth's code in `?error=`.
  const oauthError = oauthErrorCopy(params.get('error'));
  const [error, setError] = useState<string | null>(oauthError?.message ?? null);
  const [resetHint, setResetHint] = useState(!!oauthError?.reset);
  const [notice, setNotice] = useState<string | null>(null);

  // Only a session the server still accepts leaves this page: a cached identity next to a
  // 401 is a session that already ended.
  const signedIn = !!me && !meError;
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  const enter = async () => {
    await mutate('me', undefined, { revalidate: true });
    router.replace(next);
  };

  const social = async (provider: NonNullable<typeof config>['providers'][number]) => {
    setBusy(provider);
    setError(null);
    setResetHint(false);
    try {
      const origin = window.location.origin;
      const res = await authClient().signIn.social({
        provider,
        callbackURL: `${origin}${next}`,
        errorCallbackURL: `${origin}${signup ? '/signup' : '/signin'}?${new URLSearchParams({ next })}`,
      });
      if (res?.error) throw res.error;
    } catch (e) {
      setError(authErrorCopy(e, 'Could not start sign-in.'));
      setBusy(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('email');
    setError(null);
    setResetHint(false);
    setNotice(null);
    const addr = email.trim();
    try {
      if (signup) {
        // Sign-up answers the same for a new address and a taken one (no session either way),
        // so the account is opened by signing in with the password just chosen.
        const up = await authClient().signUp.email({
          email: addr,
          password,
          name: name.trim() || addr.split('@')[0] || addr,
          callbackURL: '/verify-email',
        });
        if (up.error) throw up.error;
        const inn = await authClient().signIn.email({ email: addr, password });
        if (inn.error) {
          if (inn.error.status !== 401) throw inn.error;
          // The address already had an account (its owner just got an email about it).
          setPassword('');
          setNotice(`Check ${addr} for the next step. If you already have an account, sign in or reset your password.`);
          setBusy(null);
          return;
        }
      } else {
        const res = await authClient().signIn.email({ email: addr, password });
        if (res.error) throw res.error;
      }
      await enter();
    } catch (err) {
      setError(authErrorCopy(err, signup ? 'Could not create your account.' : 'Sign-in failed.'));
      setBusy(null);
    }
  };

  const dev = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('dev');
    setError(null);
    try {
      await api.auth.devSignIn(devEmail.trim());
      await enter();
    } catch (err) {
      setError(authErrorCopy(err, 'Dev sign-in failed.'));
      setBusy(null);
    }
  };

  const providers = config?.providers ?? [];
  const emailPassword = !!config?.emailPassword;
  const nothing = config && providers.length === 0 && !config.devLogin && !emailPassword;
  const modeNote =
    signup && config?.signupMode === 'invite-only'
      ? 'KDRIVE is invite-only right now. Use the address you were invited with.'
      : signup && config?.signupMode === 'closed'
        ? 'New accounts are closed right now. Existing accounts can still sign in.'
        : null;

  return (
    <AuthFrame>
      <AuthCard className="grid max-w-[960px] grid-cols-[1.1fr_1fr] max-[860px]:grid-cols-1 max-[720px]:content-start">
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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="vx-h1">{signup ? 'Create your account' : 'Sign in'}</h2>
                <p className="vx-meta mt-1 text-vx-text-3">{signup ? 'a drive that keeps every version' : 'to continue to your drive'}</p>
                {modeNote ? <p className="vx-meta mt-2 text-vx-text-2">{modeNote}</p> : null}
              </div>
              <ThemeToggle size="sm" className="-mr-1.5 mt-0.5" />
            </div>

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
                  {providerButtonLabel(p, mode)}
                </Button>
              ))}
            </div>

            {emailPassword ? (
              <>
                {providers.length ? <OrRule /> : null}
                <form onSubmit={submit} className="flex flex-col gap-4" aria-label={signup ? 'Create account' : 'Sign in with email'}>
                  {signup ? (
                    <Input size="lg" id="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
                  ) : null}
                  <Input
                    size="lg"
                    id="email"
                    label="Email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete={signup ? 'email' : 'username'}
                    maxLength={320}
                  />
                  <div>
                    <Input
                      size="lg"
                      id="password"
                      label="Password"
                      type="password"
                      required
                      minLength={signup ? PASSWORD_MIN : undefined}
                      maxLength={PASSWORD_MAX}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={signup ? 'new-password' : 'current-password'}
                      hint={signup && !password ? `At least ${PASSWORD_MIN} characters. A few unrelated words work well.` : undefined}
                    />
                    {signup ? <StrengthMeter password={password} min={PASSWORD_MIN} /> : null}
                    {!signup && config?.passwordReset ? (
                      <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`} className="vx-meta mt-2 inline-block text-vx-text-3 hover:text-vx-text-1">
                        Forgot password?
                      </Link>
                    ) : null}
                  </div>
                  <Button variant="primary" size="lg" block type="submit" loading={busy === 'email'} disabled={!!busy && busy !== 'email'}>
                    {signup ? 'Create account' : 'Sign in'}
                  </Button>
                  {signup ? (
                    <p className="vx-micro text-center text-vx-text-3">
                      By creating an account you agree to the <Legal href={TERMS_URL}>terms of service</Legal> and{' '}
                      <Legal href={PRIVACY_URL}>privacy policy</Legal>.
                    </p>
                  ) : null}
                </form>
              </>
            ) : null}

            {emailPassword || providers.length ? (
              <p className="vx-body mt-5 text-center text-vx-text-3">
                {signup ? 'Already have an account? ' : 'New to KDRIVE? '}
                <Link href={withNext(signup ? '/signin' : '/signup', next)} className="font-medium text-vx-text-1 underline-offset-4 hover:underline">
                  {signup ? 'Sign in' : 'Create an account'}
                </Link>
              </p>
            ) : null}

            {config?.devLogin ? (
              <>
                {providers.length || emailPassword ? <OrRule /> : null}
                <form onSubmit={dev} className="rounded-vx-md border border-dashed border-vx-hair-dash p-4">
                  <div className="vx-eyebrow mb-3">Dev only</div>
                  <Input size="lg" id="dev-email" label="Email" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} autoComplete="off" />
                  <Button variant="outline" size="lg" block type="submit" className="mt-4" loading={busy === 'dev'} disabled={!!busy && busy !== 'dev'}>
                    Continue with dev account
                  </Button>
                </form>
              </>
            ) : null}

            {nothing ? (
              <ErrorRow>
                No sign-in method is configured. Set a provider&apos;s client id and secret, VOLUMES_EMAIL_PASSWORD=1, or VOLUMES_DEV_LOGIN=1 for local
                development.
              </ErrorRow>
            ) : null}
            {configError ? <ErrorRow>Can&apos;t reach the server right now. Reload the page in a moment.</ErrorRow> : null}
            {notice ? <NoticeRow>{notice}</NoticeRow> : null}
            {error ? <ErrorRow>{error}</ErrorRow> : null}
            {error && resetHint && config?.passwordReset ? (
              <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`} className="vx-meta mt-2 inline-block text-vx-text-2 underline underline-offset-2 hover:text-vx-text-1">
                Reset your password
              </Link>
            ) : null}
          </div>
        </section>
      </AuthCard>

      <footer className="relative z-[1] mt-5 flex w-full max-w-[960px] items-center gap-4 max-[720px]:mt-0 max-[720px]:bg-vx-surface max-[720px]:px-6 max-[720px]:pb-6">
        <p className="vx-micro text-vx-text-3">{RETENTION_COPY}</p>
      </footer>
    </AuthFrame>
  );
}
