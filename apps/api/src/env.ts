import { z } from 'zod';
import { DEFAULT_QUOTA_BYTES, MAX_QUOTA_BYTES } from '@volumes/shared';

/**
 * Typed, validated environment. Values come from the process env, which the
 * package scripts fill from the git-ignored `.env` files (repo root, then
 * apps/api/.env). Dev defaults let a checkout boot without any `.env`.
 */

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = () => z.preprocess(emptyToUndefined, z.string().optional());

const Raw = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'production', 'test']).default('development')),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().default('postgresql://localhost:5432/volumes_dev')),
  BETTER_AUTH_SECRET: opt(),
  BETTER_AUTH_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://localhost:4100')),
  API_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(4101)),
  PT_API_URL: opt(),
  PT_TOKEN: opt(),
  VOLUMES_STORAGE: z.preprocess(emptyToUndefined, z.enum(['emulated', 'platinum']).optional()),
  VOLUMES_DATA_DIR: z.preprocess(emptyToUndefined, z.string().default('.data')),
  VOLUMES_DEV_LOGIN: opt(),
  GOOGLE_CLIENT_ID: opt(),
  GOOGLE_CLIENT_SECRET: opt(),
  GITHUB_CLIENT_ID: opt(),
  GITHUB_CLIENT_SECRET: opt(),
  VOLUMES_ADMIN_EMAILS: opt(),
  VOLUMES_DEFAULT_QUOTA_BYTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().max(MAX_QUOTA_BYTES).default(DEFAULT_QUOTA_BYTES),
  ),
  VOLUMES_TRUSTED_ORIGINS: opt(),
  /** Interface the API listens on. Loopback by default: only the web app's rewrite on this host can reach it. */
  API_HOST: z.preprocess(emptyToUndefined, z.string().default('127.0.0.1')),
  VOLUMES_MAX_WORKSPACES_PER_USER: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).default(5)),
  /** Volumes kept free for new users' default workspaces (extra workspaces never use them). */
  VOLUMES_RESERVED_VOLUMES: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1000).default(1)),
});

export const DEV_SECRET = 'volumes-dev-secret-not-for-production-0000000000000000';
/** The placeholder shipped in .env.example; a server that still uses it has a publicly known signing key. */
export const EXAMPLE_SECRET = 'replace-with-openssl-rand-hex-32';
const MIN_SECRET_LENGTH = 32;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when a URL points at this machine only (dev login is never offered for anything else). */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type StorageDriverName = 'platinum' | 'emulated';

export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  isProd: boolean;
  isTest: boolean;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  API_PORT: number;
  PT_API_URL: string | undefined;
  PT_TOKEN: string | undefined;
  /** Resolved driver, or null when neither emulated nor platinum credentials are configured. */
  storageDriver: StorageDriverName | null;
  VOLUMES_DATA_DIR: string;
  devLoginEnabled: boolean;
  GOOGLE_CLIENT_ID: string | undefined;
  GOOGLE_CLIENT_SECRET: string | undefined;
  GITHUB_CLIENT_ID: string | undefined;
  GITHUB_CLIENT_SECRET: string | undefined;
  providers: ('google' | 'github')[];
  adminEmails: Set<string>;
  defaultQuotaBytes: number;
  trustedOrigins: string[];
  /** Session cookies carry `Secure` whenever the public origin is https (not tied to NODE_ENV). */
  secureCookies: boolean;
  API_HOST: string;
  maxWorkspacesPerUser: number;
  reservedVolumes: number;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = Raw.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const r = parsed.data;
  const isProd = r.NODE_ENV === 'production';
  // Everything outside development and test is treated as production: the
  // hardening below fails closed when NODE_ENV is missing or unexpected.
  const isLocalMode = r.NODE_ENV === 'development' || r.NODE_ENV === 'test';

  let secret = r.BETTER_AUTH_SECRET;
  if (!isLocalMode) {
    if (!secret || secret.length < MIN_SECRET_LENGTH || secret === EXAMPLE_SECRET || secret === DEV_SECRET) {
      throw new Error(
        `BETTER_AUTH_SECRET must be a private value of at least ${MIN_SECRET_LENGTH} characters outside development (openssl rand -hex 32).`,
      );
    }
  } else if (!secret) secret = DEV_SECRET;

  let storageDriver: StorageDriverName | null = null;
  if (r.VOLUMES_STORAGE === 'emulated') storageDriver = 'emulated';
  else if (r.PT_API_URL && r.PT_TOKEN) storageDriver = 'platinum';
  else if (r.VOLUMES_STORAGE === 'platinum') storageDriver = null; // asked for platinum without credentials

  const providers: ('google' | 'github')[] = [];
  if (r.GOOGLE_CLIENT_ID && r.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (r.GITHUB_CLIENT_ID && r.GITHUB_CLIENT_SECRET) providers.push('github');

  const authOrigin = new URL(r.BETTER_AUTH_URL).origin;
  const trusted = new Set<string>([authOrigin]);
  if (isLocalMode) trusted.add('http://localhost:4100');
  for (const o of (r.VOLUMES_TRUSTED_ORIGINS ?? '').split(',')) {
    const t = o.trim();
    if (t) trusted.add(t.replace(/\/$/, ''));
  }

  return {
    NODE_ENV: r.NODE_ENV,
    isProd,
    isTest: r.NODE_ENV === 'test',
    DATABASE_URL: r.DATABASE_URL,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: r.BETTER_AUTH_URL.replace(/\/$/, ''),
    API_PORT: r.API_PORT,
    PT_API_URL: r.PT_API_URL,
    PT_TOKEN: r.PT_TOKEN,
    storageDriver,
    VOLUMES_DATA_DIR: r.VOLUMES_DATA_DIR,
    // Dev login needs all three: an explicit opt-in, a development/test run and a
    // public origin on this machine. The endpoint also refuses non-loopback peers.
    devLoginEnabled: r.VOLUMES_DEV_LOGIN === '1' && isLocalMode && isLocalUrl(r.BETTER_AUTH_URL),
    GOOGLE_CLIENT_ID: r.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: r.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: r.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: r.GITHUB_CLIENT_SECRET,
    providers,
    adminEmails: new Set(
      (r.VOLUMES_ADMIN_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    defaultQuotaBytes: r.VOLUMES_DEFAULT_QUOTA_BYTES,
    trustedOrigins: [...trusted],
    secureCookies: new URL(r.BETTER_AUTH_URL).protocol === 'https:',
    API_HOST: r.API_HOST,
    maxWorkspacesPerUser: r.VOLUMES_MAX_WORKSPACES_PER_USER,
    reservedVolumes: r.VOLUMES_RESERVED_VOLUMES,
  };
}

export const env: Env = loadEnv();

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && env.adminEmails.has(email.toLowerCase());
}
