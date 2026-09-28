import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import { serveNode } from './node-serve';

let server: Server;
let base = '';

const slowBody = (chunks: number, size: number) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      await Bun.sleep(2);
      c.enqueue(new Uint8Array(size).fill(65 + i));
      if (++i >= chunks) c.close();
    },
  });
};

const ready = new Promise<void>((resolve) => {
  server = serveNode(
    async (req, conn) => {
      const u = new URL(req.url);
      if (u.pathname === '/file') return new Response(slowBody(3, 20_000), { headers: { 'Content-Length': '60000', 'Content-Type': 'application/octet-stream' } });
      if (u.pathname === '/cookies') {
        const h = new Headers();
        h.append('set-cookie', 'a=1; Path=/');
        h.append('set-cookie', 'b=2; Path=/');
        return new Response('ok', { headers: h });
      }
      if (u.pathname === '/echo') return new Response(`${req.method} ${(await req.arrayBuffer()).byteLength} ${conn.ip}`);
      return new Response('nope', { status: 404 });
    },
    { port: 0, hostname: '127.0.0.1', maxBodyBytes: 1024 },
    (addr) => {
      base = `http://${addr}`;
      resolve();
    },
  );
});

afterAll(() => server.close());

describe('serveNode', () => {
  test('keeps an explicit Content-Length on a streamed body (downloads show their size)', async () => {
    await ready;
    const r = await fetch(`${base}/file`);
    expect(r.headers.get('content-length')).toBe('60000');
    expect(r.headers.get('transfer-encoding')).toBeNull();
    expect((await r.arrayBuffer()).byteLength).toBe(60000);
  });

  test('HEAD sends headers only; several Set-Cookie headers survive', async () => {
    await ready;
    const h = await fetch(`${base}/file`, { method: 'HEAD' });
    expect(h.headers.get('content-length')).toBe('60000');
    const c = await fetch(`${base}/cookies`);
    expect(c.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  test('passes the socket address and bodies through; refuses oversized bodies', async () => {
    await ready;
    expect(await (await fetch(`${base}/echo`, { method: 'POST', body: 'x'.repeat(100) })).text()).toBe('POST 100 127.0.0.1');
    const big = await fetch(`${base}/echo`, { method: 'POST', body: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
  });
});
