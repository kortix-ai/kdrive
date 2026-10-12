'use client';

import { Suspense } from 'react';
import { SignInScreen } from '@/components/auth/sign-in-screen';

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignInScreen mode="signup" />
    </Suspense>
  );
}
