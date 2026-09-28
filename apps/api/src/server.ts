import { env } from './env';
import { createApp } from './app';
import { serveNode } from './lib/node-serve';
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
