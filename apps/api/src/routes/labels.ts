import { Hono } from 'hono';
import { AssignLabelRequest, CreateLabelRequest, LabelItemsResponse, LabelListResponse, LabelResponse, UpdateLabelRequest } from '@volumes/shared';
import { noContent, ok, parseJson } from '../lib/http';
import { assignLabel, createLabel, deleteLabel, labelItems, listLabels, updateLabel } from '../services/labels';
import type { AppEnv } from '../types';

/**
 * The drive's tags (mounted at /api/w/:ws). Everyone with access reads them;
 * requireWorkspace already refuses a viewer's writes.
 */
export const labelsRoutes = new Hono<AppEnv>();

labelsRoutes.get('/labels', async (c) => {
  return ok(c, LabelListResponse, await listLabels(c.get('ws')));
});

labelsRoutes.post('/labels', async (c) => {
  const req = await parseJson(c, CreateLabelRequest);
  const label = await createLabel(c, c.get('ws'), c.get('user').id, req);
  return ok(c, LabelResponse, { label }, 201);
});

labelsRoutes.post('/labels/assign', async (c) => {
  const req = await parseJson(c, AssignLabelRequest);
  return ok(c, LabelListResponse, await assignLabel(c.get('ws'), c.get('user').id, req));
});

labelsRoutes.get('/labels/:id/items', async (c) => {
  return ok(c, LabelItemsResponse, { items: await labelItems(c.get('ws'), c.req.param('id')) });
});

labelsRoutes.patch('/labels/:id', async (c) => {
  const req = await parseJson(c, UpdateLabelRequest);
  const label = await updateLabel(c, c.get('ws'), c.get('user').id, c.req.param('id'), req);
  return ok(c, LabelResponse, { label });
});

labelsRoutes.delete('/labels/:id', async (c) => {
  await deleteLabel(c, c.get('ws'), c.get('user').id, c.req.param('id'));
  return noContent(c);
});
