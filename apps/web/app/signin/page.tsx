'use client';

import { Suspense } from 'react';
import { SignInScreen } from '@/components/auth/sign-in-screen';

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInScreen mode="signin" />
    </Suspense>
  );
}
