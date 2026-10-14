// Preloaded by bunfig.toml before any test file. Forces the test environment
// (overriding anything Bun auto-loaded from .env), migrates volumes_test once,
// and gives every test run a fresh emulator data dir.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'volumes-test-'));

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.VOLUMES_TEST_DATABASE_URL ?? 'postgresql://localhost:5432/volumes_test',
  VOLUMES_STORAGE: 'emulated',
  VOLUMES_DATA_DIR: dataDir,
  VOLUMES_DEV_LOGIN: '1',
  BETTER_AUTH_URL: 'http://localhost:4100',
  BETTER_AUTH_SECRET: 'volumes-test-secret-0000000000000000000000000000',
  VOLUMES_ADMIN_EMAILS: 'admin@test.local',
  VOLUMES_DEFAULT_QUOTA_BYTES: String(10 * 1024 ** 3),
  // A fake Google client, so the provider is wired as in production. Nothing reaches Google:
  // test/e2e/google-auth.test.ts answers its token endpoint in-process.
  GOOGLE_CLIENT_ID: 'kdrive-test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'kdrive-test-google-secret',
  GITHUB_CLIENT_ID: '',
  GITHUB_CLIENT_SECRET: '',
});

// Account mail is swallowed unless a test captures it (test/mail.ts), so suites that create
// users through dev login do not print welcome mails.
const { setEmailSinkForTests } = await import('../src/email/client');
setEmailSinkForTests(() => {});

const { runMigrations } = await import('../src/db/migrate');
await runMigrations(process.env.DATABASE_URL!);

export const TEST_DATA_DIR = dataDir;
