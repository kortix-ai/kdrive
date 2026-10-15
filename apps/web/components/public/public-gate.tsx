'use client';

// What a share link shows before its content when it has access controls: a password form, a sign-in
// prompt for a link limited to specific people, or the account mismatch. Nothing here names the item:
// the API refuses the link's meta until the visitor passes.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogIn, Users } from 'lucide-react';
import type { LinkKind } from '@volumes/shared';
import { Button, buttonClass } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { signOutAndEnd } from '@/lib/session';

export type GateKind = 'password' | 'sign-in' | 'wrong-account';

/** The gate an error from the link's meta asks for, or null when it is not an access error. */
export function gateFor(err: unknown): { kind: GateKind; email?: string; verified?: boolean } | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'link_password_required') return { kind: 'password' };
  if (err.code === 'link_sign_in_required') return { kind: 'sign-in' };
  if (err.code === 'link_wrong_account') {
    const email = typeof err.details.email === 'string' ? err.details.email : undefined;
    return { kind: 'wrong-account', email, verified: err.details.verified !== false };
  }
  return null;
}

/** Sign-in URL that comes back to this link. */
export function signInHref(next: string): string {
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** The gate card: a 40 px icon tile, a title, one line, then the form or the actions. */
function GateCard({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <section className="vx-sheet w-full max-w-[400px] px-6 pb-6 pt-7">
        <span aria-hidden className="inline-flex h-10 w-10 items-center justify-center rounded-vx-md bg-vx-surface-3 text-vx-text-2">
          {icon}
        </span>
        <h1 className="vx-title mt-4">{title}</h1>
        <p className="vx-body mt-1.5 text-vx-text-3">{body}</p>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}

function PasswordGate({ token, kind, onUnlocked }: { token: string; kind: LinkKind; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.public.unlock(token, password, kind);
      onUnlocked();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.code === 'link_password_incorrect') setError('That password is not right.');
      else if (apiErr?.status === 429) {
        const mins = apiErr.retryAfterSeconds ? Math.max(1, Math.ceil(apiErr.retryAfterSeconds / 60)) : null;
        setError(`Too many tries. Try again in ${mins ? `${mins} minute${mins === 1 ? '' : 's'}` : 'a few minutes'}.`);
      } else setError(err instanceof Error ? err.message : "Couldn't check the password.");
      setBusy(false);
    }
  };

  return (
    <GateCard icon={<KeyRound size={20} strokeWidth={1.75} />} title="This link needs a password" body="Ask the person who shared it for the password.">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Input
          type="password"
          autoFocus
          autoComplete="off"
          aria-label="Password"
          placeholder="Password"
          value={password}
          invalid={error}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="primary" block loading={busy} disabled={!password}>
          Open
        </Button>
      </form>
    </GateCard>
  );
}

function SignInGate({ next }: { next: string }) {
  return (
    <GateCard
      icon={<Users size={20} strokeWidth={1.75} />}
      title="Sign in to open this link"
      body="This link is for specific people. Sign in with the email address it was shared with."
    >
      <a href={signInHref(next)} className={buttonClass('primary', 'md', { withIcon: true, block: true })}>
        <LogIn size={16} strokeWidth={1.75} aria-hidden />
        Sign in
      </a>
    </GateCard>
  );
}

function WrongAccountGate({ next, email, verified }: { next: string; email?: string; verified?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const switchAccount = async () => {
    setBusy(true);
    await signOutAndEnd();
    router.push(signInHref(next));
  };
  return (
    <GateCard
      icon={<Users size={20} strokeWidth={1.75} />}
      title="This link is for specific people."
      body={
        <>
          {email ? (
            <>
              You&apos;re signed in as <span className="text-vx-text-1">{email}</span>.{' '}
            </>
          ) : null}
          {verified === false ? 'Verify this address to open the link, or sign in with another one.' : 'Sign in with the address it was shared with.'}
        </>
      }
    >
      <Button variant="primary" block loading={busy} onClick={() => void switchAccount()}>
        Switch account
      </Button>
    </GateCard>
  );
}

/** The gate for an access error. `next`: this page's path, for the round trip through sign-in. */
export function PublicGate({
  gate,
  token,
  kind = 'view',
  next,
  onUnlocked,
}: {
  gate: NonNullable<ReturnType<typeof gateFor>>;
  token: string;
  /** `upload`: the gate of an upload link. */
  kind?: LinkKind;
  next: string;
  onUnlocked: () => void;
}) {
  if (gate.kind === 'password') return <PasswordGate token={token} kind={kind} onUnlocked={onUnlocked} />;
  if (gate.kind === 'sign-in') return <SignInGate next={next} />;
  return <WrongAccountGate next={next} email={gate.email} verified={gate.verified} />;
}

export default PublicGate;
