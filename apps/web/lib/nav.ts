'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { decodePathFromUrl } from '@volumes/shared';
import { driveHref } from './urls';

/** The drive path from the `/drive/[[...path]]` route params ('/' at the root or on invalid input). */
export function useDrivePath(): string {
  const params = useParams<{ path?: string[] | string }>();
  const raw = params?.path;
  return useMemo(() => {
    try {
      return decodePathFromUrl(raw);
    } catch {
      return '/';
    }
  }, [Array.isArray(raw) ? raw.join('/') : raw]);
}

/** `(path) => router.push(driveHref(path))` */
export function useOpenFolder(): (path: string) => void {
  const router = useRouter();
  return useCallback((path: string) => router.push(driveHref(path)), [router]);
}
