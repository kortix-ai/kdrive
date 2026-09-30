// Starts the real API server in a child process for end-to-end tests that
// need a network origin (MCP clients over Streamable HTTP, OAuth redirects).
// It runs against the test database with the emulated store, a fresh data
// dir and dev login on, and listens on a free loopback port.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

const API_DIR = nodePath.join(import.meta.dir, '../..');

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

export interface RunningServer {
  /** e.g. http://127.0.0.1:53124 (also the server's BETTER_AUTH_URL). */
  base: string;
  stop(): Promise<void>;
}

export async function startServer(opts: { env?: Record<string, string> } = {}): Promise<RunningServer> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(nodePath.join(tmpdir(), 'vx-e2e-server-'));
  const child = Bun.spawn(['bun', '--no-env-file', 'src/server.ts'], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/volumes_test',
      VOLUMES_STORAGE: 'emulated',
      VOLUMES_DATA_DIR: dataDir,
      VOLUMES_DEV_LOGIN: '1',
      BETTER_AUTH_URL: base,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'volumes-test-secret-0000000000000000000000000000',
      API_PORT: String(port),
      API_HOST: '127.0.0.1',
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stop = async () => {
    child.kill();
    await child.exited;
    rmSync(dataDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) {
      const err = await new Response(child.stderr).text();
      rmSync(dataDir, { recursive: true, force: true });
      throw new Error(`API server exited early (${child.exitCode}): ${err.slice(0, 2000)}`);
    }
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error('API server did not become healthy within 20 s');
    }
    await Bun.sleep(100);
  }
  return { base, stop };
}
