import { Hono } from 'hono';
import { InvitationListResponse, WorkspaceResponse } from '@volumes/shared';
import { noContent, ok } from '../lib/http';
import { acceptInvitation, declineInvitation, listInvitations } from '../services/members';
import type { AppEnv } from '../types';

/** /api/invitations: invitations to other people's drives addressed to the signed-in user. */
export const invitationsRoutes = new Hono<AppEnv>();

invitationsRoutes.get('/', async (c) => ok(c, InvitationListResponse, { invitations: await listInvitations(c.get('user')) }));

invitationsRoutes.post('/:id/accept', async (c) => {
  const workspace = await acceptInvitation(c, c.get('user'), c.req.param('id'));
  return ok(c, WorkspaceResponse, { workspace });
});

invitationsRoutes.post('/:id/decline', async (c) => {
  await declineInvitation(c.get('user'), c.req.param('id'));
  return noContent(c);
});
