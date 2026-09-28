import { Hono } from 'hono';
import { CreateLinkRequest, LinkListQuery, LinkListResponse, LinkResponse, UpdateLinkRequest } from '@volumes/shared';
import { noContent, ok, parseJson, parseQuery } from '../lib/http';
import { createLink, listLinks, revokeLink, updateLink } from '../services/links';
import type { AppEnv } from '../types';

/**
 * Share links of one workspace (mounted at /api/w/:ws; `requireWorkspace`
 * already resolved c.var.ws from the session user).
 */
export const linksRoutes = new Hono<AppEnv>();

linksRoutes.get('/links', async (c) => {
  const q = parseQuery(c, LinkListQuery);
  return ok(c, LinkListResponse, { links: await listLinks(c.get('ws'), q.path) });
});

linksRoutes.post('/links', async (c) => {
  const req = await parseJson(c, CreateLinkRequest);
  const link = await createLink(c, c.get('ws'), c.get('user').id, req);
  return ok(c, LinkResponse, { link }, 201);
});

linksRoutes.patch('/links/:id', async (c) => {
  const req = await parseJson(c, UpdateLinkRequest);
  const link = await updateLink(c, c.get('ws'), c.get('user').id, c.req.param('id'), req);
  return ok(c, LinkResponse, { link });
});

linksRoutes.delete('/links/:id', async (c) => {
  await revokeLink(c, c.get('ws'), c.get('user').id, c.req.param('id'));
  return noContent(c);
});
