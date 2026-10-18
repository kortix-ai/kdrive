'use client';

// Sign in / create account: one frosted card on the paper, the ASCII grain and glass objects around it. The
// top bar holds the lockup, the switch to the other mode and the theme toggle. In the card: one outline button
// per configured provider (labels come from config, never hard-coded), the email + password form, the dev-only
// email block, inline errors (no toasts), and `?next=` honoured across both modes. Retention copy closes the card.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react';
import { PASSWORD_MAX, PASSWORD_MIN, RETENTION_COPY } from '@volumes/shared';
import { AuthCard, AuthFrame } from '@/components/auth/auth-frame';
import { ErrorRow, NoticeRow, OrRule, StrengthMeter, authErrorCopy, oauthErrorCopy, providerButtonLabel, safeNext } from '@/components/auth/auth-bits';
import { KMark } from '@/components/brand/k-mark';
import { Brand } from '@/components/shell/brand';
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
    <a href={href} target="_blank" rel="noreferrer" className="text-vx-text-2 underline decoration-vx-hair-strong underline-offset-[3px] hover:text-vx-text-1">
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
  const [reveal, setReveal] = useState(false);
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

  const switchHref = withNext(signup ? '/signin' : '/signup', next);
  const forgotHref = `/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`;
  const legal = TERMS_URL || PRIVACY_URL;

  return (
    <AuthFrame
      bar={
        <>
          <Brand href="/" size={22} />
          <div className="flex items-center gap-3">
            {emailPassword || providers.length ? (
              <span className="text-[15px] leading-6 text-vx-text-2">
                <span className="max-[720px]:hidden">{signup ? 'Have an account? ' : 'New here? '}</span>
                <Link href={switchHref} className="font-medium text-vx-text-1 underline decoration-vx-hair-strong underline-offset-[3px] hover:decoration-vx-text-1">
                  {signup ? 'Sign in' : 'Create an account'}
                </Link>
              </span>
            ) : null}
            <ThemeToggle size="md" className="-mr-1.5" />
          </div>
        </>
      }
      foot={
        <>
          {PRIVACY_URL ? <Legal href={PRIVACY_URL}>Privacy</Legal> : null}
          {TERMS_URL ? <Legal href={TERMS_URL}>Terms</Legal> : null}
          {legal ? null : <span className="font-mono text-[12px]">every version · kept</span>}
        </>
      }
    >
      <AuthCard className="max-w-[440px] px-[34px] pb-7 pt-[34px] max-[720px]:px-5 max-[720px]:pb-[22px] max-[720px]:pt-[26px]">
        <main>
          <KMark size={36} />
          <h1 className="mb-1.5 mt-5 text-[32px] font-semibold leading-[38px] tracking-[-0.03em] text-vx-text-1 max-[720px]:text-[28px] max-[720px]:leading-[34px]">
            {signup ? (
              <>
                Start your <span>drive.</span>
              </>
            ) : (
              <>
                Welcome <span>back.</span>
              </>
            )}
          </h1>
          <p className="text-[16px] leading-6 text-vx-text-2">
            {signup ? 'A drive that keeps every version of every file.' : 'Sign in to pick up where your drive left off.'}
          </p>
          {modeNote ? <p className="mt-2 text-[14px] leading-5 text-vx-text-2">{modeNote}</p> : null}

          <div className="mt-6 flex flex-col gap-3">
            {!config && !configError ? (
              <>
                <span className="skeleton block h-12 w-full !rounded-vx-md" />
                <span className="skeleton block h-12 w-full !rounded-vx-md" />
              </>
            ) : null}
            {providers.map((p) => (
              <Button
                key={p}
                size="lg"
                variant="outline"
                block
                icon={p === 'google' ? <GoogleG /> : <KeyRound size={18} strokeWidth={1.75} aria-hidden />}
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
              {providers.length ? <OrRule label="or with email" /> : <div className="h-2" />}
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
                  leading={<Mail size={18} strokeWidth={1.7} aria-hidden />}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete={signup ? 'email' : 'username'}
                  maxLength={320}
                />
                <div className="mb-1.5">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <label htmlFor="password" className="text-[14px] font-medium leading-5 text-vx-text-2">
                      Password
                    </label>
                    {!signup && config?.passwordReset ? (
                      <Link href={forgotHref} className="text-[14px] leading-5 text-vx-text-2 underline decoration-vx-hair-strong underline-offset-[3px] hover:text-vx-text-1">
                        Forgot?
                      </Link>
                    ) : null}
                  </div>
                  <Input
                    size="lg"
                    id="password"
                    type={reveal ? 'text' : 'password'}
                    required
                    leading={<Lock size={18} strokeWidth={1.7} aria-hidden />}
                    suffix={
                      <button
                        type="button"
                        onClick={() => setReveal((r) => !r)}
                        aria-label={reveal ? 'Hide password' : 'Show password'}
                        aria-pressed={reveal}
                        className="-mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-vx-sm text-vx-text-3 hover:bg-vx-raise hover:text-vx-text-1"
                      >
                        {reveal ? <EyeOff size={18} strokeWidth={1.7} aria-hidden /> : <Eye size={18} strokeWidth={1.7} aria-hidden />}
                      </button>
                    }
                    minLength={signup ? PASSWORD_MIN : undefined}
                    maxLength={PASSWORD_MAX}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={signup ? 'new-password' : 'current-password'}
                    hint={signup && !password ? `At least ${PASSWORD_MIN} characters. A few unrelated words work well.` : undefined}
                  />
                  {signup ? <StrengthMeter password={password} min={PASSWORD_MIN} /> : null}
                </div>
                <Button variant="primary" size="lg" block type="submit" loading={busy === 'email'} disabled={!!busy && busy !== 'email'}>
                  {signup ? 'Create account' : 'Sign in'}
                </Button>
                {signup ? (
                  <p className="text-center text-[13px] leading-5 text-vx-text-3">
                    By creating an account you agree to the <Legal href={TERMS_URL}>terms of service</Legal> and{' '}
                    <Legal href={PRIVACY_URL}>privacy policy</Legal>.
                  </p>
                ) : null}
              </form>
            </>
          ) : null}

          {config?.devLogin ? (
            <>
              {providers.length || emailPassword ? <OrRule label="or for local development" /> : null}
              <form onSubmit={dev} className="rounded-vx-md border border-dashed border-vx-hair-dash p-4">
                <div className="vx-eyebrow mb-3">Dev only</div>
                <Input size="md" id="dev-email" label="Email" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} autoComplete="off" />
                <Button variant="outline" size="md" block type="submit" className="mt-3" loading={busy === 'dev'} disabled={!!busy && busy !== 'dev'}>
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
            <Link href={forgotHref} className="mt-2 inline-block text-[14px] text-vx-text-2 underline underline-offset-2 hover:text-vx-text-1">
              Reset your password
            </Link>
          ) : null}

          <p className="mt-[18px] text-center text-[14px] leading-5 text-vx-text-3">{RETENTION_COPY}</p>
        </main>
      </AuthCard>
    </AuthFrame>
  );
}

/** Google's four-colour G, the one brand mark the sign-in page shows (on the provider's own button). */
function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}
