'use client';

import useSWR from 'swr';

/** A failed content fetch (the API error envelope, when there is one). */
export class ContentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

/** Human copy for a content / stat failure. Never leaks server internals. */
export function contentErrorCopy(status: number, code: string | undefined): { title: string; body?: string; retry: boolean } {
  if (code === 'version_gone') return { title: 'This version is no longer kept.', retry: false };
  if (code === 'link_expired' || code === 'link_revoked') return { title: 'This link is no longer active.', retry: false };
  if (status === 404 || code === 'path_not_found') return { title: 'This file is no longer here.', body: 'It was moved or deleted.', retry: false };
  if (status === 429 || code === 'rate_limited') return { title: 'Too many requests.', body: 'Try again in a minute.', retry: true };
  if (status === 0) return { title: "Couldn't reach the server.", body: 'Check your connection.', retry: true };
  return { title: "Couldn't load this file", retry: true };
}

async function fetchText(src: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(src, { credentials: 'same-origin', headers: { accept: 'text/plain, */*' } });
  } catch {
    throw new ContentError(0, 'upstream_unavailable', "Couldn't reach the server.");
  }
  if (!res.ok) {
    let code = 'internal';
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new ContentError(res.status, code, message);
  }
  return res.text();
}

/**
 * The bytes at `src` decoded as UTF-8 text (text, code, Markdown, CSV, JSON and active content).
 * Cached per URL; `refresh()` in the store revalidates it after a mutation.
 */
export function useTextContent(src: string | null) {
  return useSWR<string, ContentError>(src ? ['vx-text', src] : null, () => fetchText(src!), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: false,
  });
}
