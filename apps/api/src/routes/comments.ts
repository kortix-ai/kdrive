import { Hono } from 'hono';
import {
  CommentCountsResponse,
  CommentListQuery,
  CommentListResponse,
  CommentResponse,
  CreateCommentRequest,
  UpdateCommentRequest,
} from '@volumes/shared';
import { noContent, ok, parseJson, parseQuery } from '../lib/http';
import { addComment, commentCounts, deleteComment, listComments, updateComment } from '../services/comments';
import type { AppEnv } from '../types';

/**
 * Comments on files (mounted at /api/w/:ws). Viewers comment too: requireWorkspace
 * lets their writes through here (COMMENT_ROUTES), and the service decides who may
 * edit or delete what.
 */
export const commentsRoutes = new Hono<AppEnv>();

commentsRoutes.get('/comments', async (c) => {
  const q = parseQuery(c, CommentListQuery);
  return ok(c, CommentListResponse, { comments: await listComments(c.get('ws'), c.get('user').id, q.path) });
});

commentsRoutes.get('/comments/counts', async (c) => {
  return ok(c, CommentCountsResponse, { counts: await commentCounts(c.get('ws')) });
});

commentsRoutes.post('/comments', async (c) => {
  const req = await parseJson(c, CreateCommentRequest);
  const comment = await addComment(c.get('ws'), c.get('user').id, req);
  return ok(c, CommentResponse, { comment }, 201);
});

commentsRoutes.patch('/comments/:id', async (c) => {
  const req = await parseJson(c, UpdateCommentRequest);
  const comment = await updateComment(c.get('ws'), c.get('user').id, c.req.param('id'), req);
  return ok(c, CommentResponse, { comment });
});

commentsRoutes.delete('/comments/:id', async (c) => {
  await deleteComment(c, c.get('ws'), c.get('user').id, c.req.param('id'));
  return noContent(c);
});
