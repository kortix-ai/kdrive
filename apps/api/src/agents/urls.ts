import { basename, dirname, encodePathForUrl } from '@volumes/shared';
import { env } from '../env';

/**
 * Public URLs for agent access. Everything derives from BETTER_AUTH_URL, the
 * public web origin (the web app rewrites /mcp, /api/* and the discovery
 * documents to the API), so no extra env key is needed.
 */
export const PUBLIC_ORIGIN = env.BETTER_AUTH_URL; // no trailing slash
/** jwt plugin issuer + authorization-server metadata issuer. */
export const OAUTH_ISSUER = PUBLIC_ORIGIN;
/** The MCP resource: JWT audience and the protected-resource `resource`. */
export const MCP_RESOURCE = `${PUBLIC_ORIGIN}/mcp`;
export const PRM_URL = `${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource`;
export const JWKS_PATH = '/api/auth/jwks';
export const OAUTH_SIGN_IN_PAGE = `${PUBLIC_ORIGIN}/oauth/sign-in`;
export const OAUTH_CONSENT_PAGE = `${PUBLIC_ORIGIN}/oauth/consent`;

function withQuery(path: string, params: Record<string, string>): string {
  return `${PUBLIC_ORIGIN}${path}?${new URLSearchParams(params).toString()}`;
}

function drivePath(path: string): string {
  const enc = encodePathForUrl(path);
  return enc ? `/drive/${enc}` : '/drive';
}

/**
 * Browser URL of a drive path in a workspace. A folder opens its listing; a
 * file opens its parent folder with the preview (`file=<name>`).
 */
export function driveUrl(wsId: string, path: string, type: 'file' | 'dir'): string {
  if (type === 'dir') return withQuery(drivePath(path), { ws: wsId });
  return withQuery(drivePath(dirname(path)), { ws: wsId, file: basename(path) });
}

/** The review page of a proposal; with `seq`, that change is selected. */
export function proposalUrl(wsId: string, id: string, seq?: number): string {
  return withQuery(`/proposals/${encodeURIComponent(id)}`, seq === undefined ? { ws: wsId } : { ws: wsId, seq: String(seq) });
}

/** One file compared between two versions. */
export function compareUrl(wsId: string, path: string, a: string, b: string): string {
  return withQuery('/compare', { ws: wsId, path, a, b });
}

/** The whole drive compared between two versions. */
export function driveCompareUrl(wsId: string, a: string, b: string): string {
  return withQuery('/compare/drive', { ws: wsId, a, b });
}
