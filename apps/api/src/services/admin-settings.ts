import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { AdminSettingsResponse } from '@volumes/shared';
import { env } from '../env';
import { billingEnabled } from './billing-config';

// Admin → Settings: the server's configuration at a glance, read-only. Only whether a secret is
// set, never its value.

const startedAt = new Date();

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

let commitCache: string | null | undefined;

/** VOLUMES_COMMIT, else the checkout's HEAD (short), else null. Read once. */
export function serverCommit(): string | null {
  if (commitCache !== undefined) return commitCache;
  commitCache = env.commit;
  if (!commitCache) {
    try {
      const r = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', timeout: 2000 });
      const out = r.status === 0 ? r.stdout.trim() : '';
      commitCache = /^[0-9a-f]{7,40}$/.test(out) ? out : null;
    } catch {
      commitCache = null;
    }
  }
  return commitCache;
}

const VERSION = readVersion();

/** GET /api/admin/settings. */
export async function adminSettings(): Promise<AdminSettingsResponse> {
  return {
    publicUrl: env.BETTER_AUTH_URL,
    signup: {
      mode: env.signupMode,
      allowlistSize: env.signupAllowlist.length,
      emailPassword: env.emailPassword,
      requireEmailVerification: env.requireEmailVerification,
    },
    email: {
      configured: !!(env.RESEND_API_KEY || env.MAILTRAP_API_TOKEN),
      provider: env.RESEND_API_KEY ? 'resend' : env.MAILTRAP_API_TOKEN ? 'mailtrap' : null,
      from: env.emailFrom.name ? `${env.emailFrom.name} <${env.emailFrom.email}>` : env.emailFrom.email,
    },
    providers: { google: env.providers.includes('google'), github: env.providers.includes('github') },
    storage: { mode: env.storageDriver },
    mcpEnabled: env.mcpEnabled,
    defaultQuotaBytes: env.defaultQuotaBytes,
    maxWorkspacesPerUser: env.maxWorkspacesPerUser,
    adminEmails: [...env.adminEmails],
    billing: { enabled: await billingEnabled().catch(() => false) },
    version: VERSION,
    commit: serverCommit(),
    nodeEnv: env.NODE_ENV,
    startedAt: startedAt.toISOString(),
  };
}
