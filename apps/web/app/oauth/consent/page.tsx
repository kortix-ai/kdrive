'use client';

// /oauth/consent: the OAuth provider sends a signed-in user here with its signed query.
// Signed out → /oauth/sign-in with the same query.
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ConsentCard, OAuthShell } from '@/components/agents/consent-card';
import { useMeIfSignedIn } from '@/lib/api/hooks';

function Consent() {
  const params = useSearchParams();
  const query = params.toString();
  const { data: me, error, signedOut } = useMeIfSignedIn();

  useEffect(() => {
    if (signedOut) window.location.assign(`/oauth/sign-in${window.location.search}`);
  }, [signedOut]);

  if (!me || error) {
    return (
      <OAuthShell>
        {error && !signedOut ? (
          <p className="vx-body text-vx-text-3">Can&apos;t reach the server right now. Reload the page in a moment.</p>
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true">
            <span className="skeleton block h-10 w-10 !rounded-vx-sm" />
            <span className="skeleton block h-6 w-3/4" />
          </div>
        )}
      </OAuthShell>
    );
  }
  return (
    <OAuthShell>
      <ConsentCard oauthQuery={query} />
    </OAuthShell>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <Consent />
    </Suspense>
  );
}
