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
});

const DEV_SECRET = 'volumes-dev-secret-not-for-production-0000000000000000';

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
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = Raw.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const r = parsed.data;
  const isProd = r.NODE_ENV === 'production';

  let secret = r.BETTER_AUTH_SECRET;
  if (!secret) {
    if (isProd) throw new Error('BETTER_AUTH_SECRET must be set in production (openssl rand -hex 32).');
    secret = DEV_SECRET;
  }

  let storageDriver: StorageDriverName | null = null;
  if (r.VOLUMES_STORAGE === 'emulated') storageDriver = 'emulated';
  else if (r.PT_API_URL && r.PT_TOKEN) storageDriver = 'platinum';
  else if (r.VOLUMES_STORAGE === 'platinum') storageDriver = null; // asked for platinum without credentials

  const providers: ('google' | 'github')[] = [];
  if (r.GOOGLE_CLIENT_ID && r.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (r.GITHUB_CLIENT_ID && r.GITHUB_CLIENT_SECRET) providers.push('github');

  const authOrigin = new URL(r.BETTER_AUTH_URL).origin;
  const trusted = new Set<string>([authOrigin]);
  if (!isProd) trusted.add('http://localhost:4100');
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
    devLoginEnabled: r.VOLUMES_DEV_LOGIN === '1' && !isProd,
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
  };
}

export const env: Env = loadEnv();

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && env.adminEmails.has(email.toLowerCase());
}
