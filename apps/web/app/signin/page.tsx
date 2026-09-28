'use client';

// Sign-in (FOUNDATION wired it to better-auth; WEB-preview-share-settings owns the file and may restyle it).
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { RETENTION_COPY } from '@volumes/shared';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { VoxelArt } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/endpoints';
import { useConfig, useMe } from '@/lib/api/hooks';
import { signInSocial } from '@/lib/auth-client';

/** Only same-origin relative paths are honoured as `?next=`. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/signin')) return '/drive';
  return raw;
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.7 14.55 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.36-3.37-1.36-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.64 1.03 2.76 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.07 10.07 0 0 0 22 12.22C22 6.58 17.52 2 12 2z" />
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

  const social = async (provider: 'google' | 'github') => {
    setBusy(provider);
    setError(null);
    try {
      const callback = `${window.location.origin}${next}`;
      await signInSocial(provider, callback);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start sign-in.');
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
      setError(err instanceof Error ? err.message : 'Dev sign-in failed.');
      setBusy(null);
    }
  };

  const providers = config?.providers ?? [];
  const nothing = config && providers.length === 0 && !config.devLogin;

  return (
    <div className="grid h-dvh grid-cols-1 overflow-auto min-[720px]:grid-cols-2">
      <aside
        className="relative flex h-[120px] items-center justify-center overflow-hidden border-b border-[#1e1e22] min-[720px]:h-auto min-[720px]:border-b-0 min-[720px]:border-r"
        style={{ background: '#0a0a0c' }}
        aria-hidden
      >
        <div className="scale-[0.55] min-[720px]:scale-150">
          <VoxelArt float={false} />
        </div>
        <div className="absolute bottom-6 left-6 hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[#6e6e76] min-[720px]:block">
          The dashed slab is the version you can go back to.
        </div>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-[360px] max-w-full">
          <div className="vx-label text-vx-text-1">Volumes</div>
          <h1 className="vx-display vx-metal mt-4">Every change is a version.</h1>
          <p className="vx-body mt-3 text-vx-text-3">A personal drive you can scrub back through time, compare, restore and share.</p>

          <div className="mt-8 flex flex-col gap-2">
            {providers.includes('google') ? (
              <Button size="lg" icon={<GoogleGlyph />} onClick={() => social('google')} loading={busy === 'google'} disabled={!!busy}>
                Continue with Google
              </Button>
            ) : null}
            {providers.includes('github') ? (
              <Button size="lg" icon={<GitHubGlyph />} onClick={() => social('github')} loading={busy === 'github'} disabled={!!busy}>
                Continue with GitHub
              </Button>
            ) : null}
          </div>

          {config?.devLogin ? (
            <form onSubmit={dev} className="mt-6 border border-dashed border-vx-hair-dash p-4">
              <div className="vx-label mb-3">Dev only</div>
              <label className="sr-only" htmlFor="dev-email">
                Email
              </label>
              <Input id="dev-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} mono autoComplete="email" />
              <div className="mt-3">
                <Button variant="platinum" type="submit" loading={busy === 'dev'} disabled={!!busy && busy !== 'dev'}>
                  Continue with dev account
                </Button>
              </div>
            </form>
          ) : null}

          {nothing ? (
            <p className="mt-6 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">
              No sign-in method is configured. Set GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET, or VOLUMES_DEV_LOGIN=1 for local development.
            </p>
          ) : null}
          {configError ? (
            <p className="mt-6 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">Cannot reach the API. Is it running on port 4101?</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-10 flex items-center justify-between gap-4">
            <p className="vx-meta text-vx-text-4">{RETENTION_COPY}</p>
            <ThemeToggle />
          </div>
        </div>
      </main>
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
