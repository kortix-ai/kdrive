import { Hono } from 'hono';
import {
  CreateWorkspaceRequest,
  DrivePeopleResponse,
  DuplicateWorkspaceRequest,
  InviteRequest,
  InviteResponse,
  UpdateMemberRequest,
  UpdateWorkspaceRequest,
  WorkspaceListResponse,
  WorkspaceResponse,
} from '@volumes/shared';
import { ApiError, noContent, ok, parseJson } from '../lib/http';
import { inviteToWorkspace, listPeople, removeMember, revokeInvite, updateMemberRole } from '../services/members';
import {
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  listWorkspaceSummaries,
  renameWorkspace,
} from '../services/workspace-admin';
import type { AppEnv } from '../types';

/** /api/workspaces: the signed-in user's workspaces (one Platinum volume each) and their people. */
export const workspacesRoutes = new Hono<AppEnv>();

const CONTROL = /[\u0000-\u001f\u007f]/;
function checkName(name: string): string {
  if (CONTROL.test(name)) throw new ApiError(400, 'invalid_name', 'Workspace names cannot contain control characters.');
  return name;
}

workspacesRoutes.get('/', async (c) => ok(c, WorkspaceListResponse, { workspaces: await listWorkspaceSummaries(c.get('user').id) }));

workspacesRoutes.post('/', async (c) => {
  const req = await parseJson(c, CreateWorkspaceRequest);
  const workspace = await createWorkspace(c, c.get('user').id, checkName(req.name));
  return ok(c, WorkspaceResponse, { workspace }, 201);
});

workspacesRoutes.patch('/:id', async (c) => {
  const req = await parseJson(c, UpdateWorkspaceRequest);
  const workspace = await renameWorkspace(c.get('user').id, c.req.param('id'), checkName(req.name));
  return ok(c, WorkspaceResponse, { workspace });
});

workspacesRoutes.delete('/:id', async (c) => {
  await deleteWorkspace(c, c.get('user').id, c.req.param('id'));
  return noContent(c);
});

workspacesRoutes.post('/:id/duplicate', async (c) => {
  const req = await parseJson(c, DuplicateWorkspaceRequest);
  const workspace = await duplicateWorkspace(c, c.get('user').id, c.req.param('id'), { name: checkName(req.name), at: req.at });
  return ok(c, WorkspaceResponse, { workspace }, 201);
});

// ── people ──────────────────────────────────────────────────────────────────
// Anyone with access sees who else has it; only the owner sees open invitations,
// invites, changes roles and removes people. A member removes themselves to leave.

workspacesRoutes.get('/:id/people', async (c) => ok(c, DrivePeopleResponse, await listPeople(c.get('user').id, c.req.param('id'))));

workspacesRoutes.post('/:id/invites', async (c) => {
  const req = await parseJson(c, InviteRequest);
  const invite = await inviteToWorkspace(c, c.get('user'), c.req.param('id'), req);
  return ok(c, InviteResponse, { invite }, 201);
});

workspacesRoutes.delete('/:id/invites/:inviteId', async (c) => {
  await revokeInvite(c, c.get('user').id, c.req.param('id'), c.req.param('inviteId'));
  return noContent(c);
});

workspacesRoutes.patch('/:id/members/:userId', async (c) => {
  const req = await parseJson(c, UpdateMemberRequest);
  await updateMemberRole(c, c.get('user').id, c.req.param('id'), c.req.param('userId'), req.role);
  return ok(c, DrivePeopleResponse, await listPeople(c.get('user').id, c.req.param('id')));
});

workspacesRoutes.delete('/:id/members/:userId', async (c) => {
  await removeMember(c, c.get('user').id, c.req.param('id'), c.req.param('userId'));
  return noContent(c);
});
