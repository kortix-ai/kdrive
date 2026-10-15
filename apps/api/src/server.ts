import { env } from './env';
import { createApp } from './app';
import { serveNode } from './lib/node-serve';
import { reconcileEnvAdmins } from './services/admins';
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
  // VOLUMES_ADMIN_EMAILS is the source of truth for admins: mirror it into the table (idempotent).
  reconcileEnvAdmins().then(
    ({ added, removed }) => {
      if (added.length || removed.length) {
        console.log(`[volumes-api] admins from VOLUMES_ADMIN_EMAILS: +${added.length} -${removed.length}`);
      }
    },
    (e) => console.warn('[volumes-api] could not apply VOLUMES_ADMIN_EMAILS:', e instanceof Error ? e.message : e),
  );
  // node:http (not Bun.serve): Bun.serve drops an explicit Content-Length on
  // streamed bodies, so downloads would lose their size and progress.
  serveNode(app.fetch, { port: env.API_PORT, hostname: env.API_HOST, maxBodyBytes: 64 * 1024 * 1024 }, (addr) => {
    const providers = env.providers.length ? env.providers.join(', ') : 'none';
    console.log(
      `[volumes-api] listening on http://${addr} · storage=${driver} · auth providers=${providers}` +
        (env.devLoginEnabled ? ' · dev login ON' : ''),
    );
  });
}

main();
