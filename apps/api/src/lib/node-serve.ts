// A small fetch-to-node:http bridge. The API runs on node:http rather than
// Bun.serve because Bun.serve replaces an explicit Content-Length with chunked
// encoding whenever the body is a stream that is not complete at once, which
// strips the size from every download (no progress bar, no "x of y MB").
// node:http keeps the headers exactly as the app sets them.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';

/** What the app receives as its Hono bindings: the connecting socket's address. */
export interface ConnInfo {
  ip: string | null;
}

export type FetchHandler = (req: Request, conn: ConnInfo) => Response | Promise<Response>;

export interface ServeOptions {
  port: number;
  hostname: string;
  /** Requests with a larger body are refused with 413 before the app runs. */
  maxBodyBytes: number;
}

function toHeaders(req: IncomingMessage): Headers {
  const h = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) h.append(raw[i], raw[i + 1]);
  return h;
}

/** The request body as a web stream that stops (with 413) past `max` bytes. */
function bodyOf(req: IncomingMessage, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  const it = req[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { value, done } = await it.next();
      if (done) {
        ctrl.close();
        return;
      }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      seen += chunk.length;
      if (seen > max) {
        ctrl.error(new Error('request body too large'));
        req.destroy();
        return;
      }
      ctrl.enqueue(chunk);
    },
    cancel() {
      req.destroy();
    },
  });
}

async function writeResponse(res: ServerResponse, r: Response, head: boolean): Promise<void> {
  res.statusCode = r.status;
  const cookies = r.headers.getSetCookie();
  r.headers.forEach((v, k) => {
    if (k !== 'set-cookie') res.setHeader(k, v);
  });
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (!r.body || head) {
    res.end();
    if (r.body) await r.body.cancel().catch(() => {});
    return;
  }
  const reader = r.body.getReader();
  try {
    for (;;) {
      if (res.destroyed) {
        await reader.cancel().catch(() => {});
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(value)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
    }
    res.end();
  } catch {
    // The body failed mid-stream (the headers are gone already): cut the connection
    // so the client sees a truncated transfer rather than a short, "complete" file.
    await reader.cancel().catch(() => {});
    res.destroy();
  }
}

export function serveNode(fetch: FetchHandler, opts: ServeOptions, onListen?: (addr: string) => void): Server {
  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const len = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(len) && len > opts.maxBodyBytes) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'payload_too_large', message: 'Request body too large.' } }));
      req.destroy();
      return;
    }
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) ac.abort();
    });
    const url = `http://${req.headers.host ?? `${opts.hostname}:${opts.port}`}${req.url ?? '/'}`;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const init: RequestInit & { duplex?: 'half' } = { method, headers: toHeaders(req), signal: ac.signal };
    if (hasBody) {
      init.body = bodyOf(req, opts.maxBodyBytes);
      init.duplex = 'half';
    }
    let response: Response;
    try {
      response = await fetch(new Request(url, init), { ip: req.socket.remoteAddress ?? null });
    } catch (e) {
      console.error('[volumes-api] unhandled', e instanceof Error ? e.message : e);
      response = new Response(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    await writeResponse(res, response, method === 'HEAD');
  });
  // Long zip and video streams: no request timeout; idle keep-alive sockets close after 2 minutes.
  server.requestTimeout = 0;
  server.keepAliveTimeout = 120_000;
  server.listen(opts.port, opts.hostname, () => {
    const a = server.address();
    const addr = typeof a === 'string' ? a : a ? `${a.family === 'IPv6' ? `[${a.address}]` : a.address}:${a.port}` : `${opts.hostname}:${opts.port}`;
    onListen?.(addr);
  });
  return server;
}
