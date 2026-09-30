// The /mcp endpoint: stateless Streamable HTTP, bearer credentials only.
// (Builder B fills the body: origin check, methods, size cap, auth, rate
// limit, then one fresh server + transport per request.)
import type { Context } from 'hono';
import { env } from '../env';
import type { AppEnv } from '../types';

export async function handleMcp(_req: Request, c: Context<AppEnv>): Promise<Response> {
  if (!env.mcpEnabled) return c.json({ error: { code: 'not_found', message: 'No such route.' } }, 404);
  return c.json({ error: { code: 'not_implemented', message: 'Not implemented yet.' } }, 501);
}
