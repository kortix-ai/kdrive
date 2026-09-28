import { env } from './env';
import { createApp } from './app';
import { getStore, StorageConfigError } from './storage';

function main() {
  let driver: string;
  try {
    driver = getStore().driver;
  } catch (e) {
    if (e instanceof StorageConfigError) {
      console.error(`\n[volumes-api] ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const app = createApp();
  const server = Bun.serve({ port: env.API_PORT, fetch: app.fetch, idleTimeout: 120, maxRequestBodySize: 64 * 1024 * 1024 });
  const providers = env.providers.length ? env.providers.join(', ') : 'none';
  console.log(
    `[volumes-api] listening on http://localhost:${server.port} · storage=${driver} · auth providers=${providers}` +
      (env.devLoginEnabled ? ' · dev login ON' : ''),
  );
}

main();
