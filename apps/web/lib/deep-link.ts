'use client';

// Deep links from AI agents (MCP.md §14.8). Every browser URL an agent hands out carries the
// workspace (`?ws=<id>`); file links on /drive/** also carry `?file=<name>`.
// - `ws` that the signed-in user owns and that is not the current one → switch to it.
// - `ws` the user does not have → toast "That workspace isn't available." and stay.
// - `file` on /drive/** → open its preview once the folder's listing has loaded.
// Both are then removed from the URL (router.replace), so a reload does not repeat them.
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { decodePathFromUrl, joinPath, type MeResponse } from '@volumes/shared';
import { api } from './api/endpoints';
import { useVx } from './store';

export interface DeepLinkPlan {
  /** Switch to this workspace first. */
  switchTo: string | null;
  /** `ws` named a workspace the user does not have. */
  unknownWs: boolean;
  /** Open this file's preview (in `ws`) once its folder has loaded. */
  file: { ws: string; dir: string; name: string } | null;
  /** The URL without `ws` and `file`, or null when there was nothing to strip. */
  cleanUrl: string | null;
}

/** The drive folder of a `/drive/...` pathname (still percent-encoded), or null off the drive. */
export function drivePathOf(pathname: string): string | null {
  if (pathname !== '/drive' && !pathname.startsWith('/drive/')) return null;
  const rest = pathname.slice('/drive'.length).split('/').filter(Boolean);
  try {
    return decodePathFromUrl(rest);
  } catch {
    return null;
  }
}

/** What a URL asks for, given who is signed in and which workspace is current. Pure. */
export function planDeepLink(
  loc: { pathname: string; search: string; hash?: string },
  me: Pick<MeResponse, 'workspaces'>,
  currentWs: string | null,
): DeepLinkPlan {
  const q = new URLSearchParams(loc.search);
  const wsParam = q.get('ws');
  const fileParam = q.get('file');
  const none: DeepLinkPlan = { switchTo: null, unknownWs: false, file: null, cleanUrl: null };
  if (wsParam === null && fileParam === null) return none;

  const owned = wsParam ? me.workspaces.some((w) => w.id === wsParam) : false;
  const unknownWs = wsParam !== null && !owned;
  const target = owned ? wsParam : wsParam === null ? currentWs : null;
  const switchTo = owned && wsParam !== currentWs ? wsParam : null;

  let file: DeepLinkPlan['file'] = null;
  const dir = drivePathOf(loc.pathname);
  const name = fileParam?.trim() ?? '';
  if (target && dir !== null && name && !name.includes('/') && name !== '.' && name !== '..') file = { ws: target, dir, name };

  q.delete('ws');
  q.delete('file');
  const rest = q.toString();
  return { switchTo, unknownWs, file, cleanUrl: `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash ?? ''}` };
}

type LsKey = [string, string, string, string | null];

export function useDeepLink(): void {
  const pathname = usePathname();
  const router = useRouter();
  const me = useVx((s) => s.me);
  const ws = useVx((s) => s.workspaceId);
  const [pending, setPending] = useState<DeepLinkPlan['file']>(null);
  const [tick, setTick] = useState(0);
  const handled = useRef<string | null>(null);

  // Back/forward can bring a query back without a pathname change.
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  useEffect(() => {
    if (!me || typeof window === 'undefined') return;
    const loc = { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
    const key = `${loc.pathname}${loc.search}`;
    if (handled.current === key) return;
    const plan = planDeepLink(loc, me, useVx.getState().workspaceId);
    if (!plan.cleanUrl) {
      handled.current = null;
      return;
    }
    handled.current = key;
    const s = useVx.getState();
    if (plan.unknownWs) s.toast({ kind: 'info', message: "That workspace isn't available." });
    if (plan.switchTo) s.setWorkspace(plan.switchTo);
    setPending(plan.file);
    router.replace(plan.cleanUrl, { scroll: false });
  }, [me, pathname, tick, router]);

  // The folder's listing (the same key the drive uses, so it is fetched once).
  const ready = !!pending && ws === pending.ws;
  const key: LsKey | null = ready && pending ? ['ls', pending.ws, pending.dir, null] : null;
  const listing = useSWR(key, ([, w, p]: LsKey) => api.files.list(w, { path: p }), { revalidateOnFocus: false, shouldRetryOnError: false });

  useEffect(() => {
    if (!pending) return;
    // The user went elsewhere (another workspace) before the folder loaded: drop it.
    if (ws && ws !== pending.ws) {
      setPending(null);
      return;
    }
    if (listing.error) {
      setPending(null);
      return;
    }
    const entries = listing.data?.entries;
    if (!entries) return;
    const s = useVx.getState();
    const hit = entries.find((e) => e.name === pending.name);
    if (hit && hit.type === 'file') s.openPreview(joinPath(pending.dir, pending.name), { at: null });
    else s.toast({ kind: 'info', message: `${pending.name} isn't in this folder any more.` });
    setPending(null);
  }, [pending, ws, listing.data, listing.error]);
}
