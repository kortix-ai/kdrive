import { z } from 'zod';
import { IsoDateSchema, RefSchema } from './common';

const WorkspaceName = z.string().trim().min(1).max(60);

/** What a person may do in a drive: the owner manages it and its people, an editor changes files, a viewer only reads. */
export const DriveRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type DriveRole = z.infer<typeof DriveRoleSchema>;
/** The roles an owner can give someone else. */
export const MemberRoleSchema = z.enum(['editor', 'viewer']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const PersonSchema = z.object({ id: z.string(), name: z.string().nullable(), email: z.string() });
export type Person = z.infer<typeof PersonSchema>;

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The default drive of its owner (only ever true for the viewer's own default). */
  isDefault: z.boolean(),
  /** The signed-in user's role here. Absent from older servers: treat as owner. */
  role: DriveRoleSchema.default('owner'),
  /** Who owns the drive; null when it is the signed-in user's own. */
  owner: PersonSchema.nullable().default(null),
  createdAt: IsoDateSchema,
  usageBytes: z.number(),
  forkedFrom: z
    .object({
      workspaceId: z.string().nullable(),
      workspaceName: z.string().nullable(),
      commitId: z.string(),
    })
    .nullable(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceListResponse = z.object({ workspaces: z.array(WorkspaceSummarySchema) });
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>;

export const CreateWorkspaceRequest = z.object({ name: WorkspaceName });
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const UpdateWorkspaceRequest = z.object({ name: WorkspaceName });
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;

export const DuplicateWorkspaceRequest = z.object({ name: WorkspaceName, at: RefSchema.optional() });
export type DuplicateWorkspaceRequest = z.infer<typeof DuplicateWorkspaceRequest>;

export const WorkspaceResponse = z.object({ workspace: WorkspaceSummarySchema });
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

// ── People: members and invitations ─────────────────────────────────────────

export const DriveMemberSchema = PersonSchema.extend({
  role: DriveRoleSchema,
  /** When they joined (the owner: when the drive was created). */
  since: IsoDateSchema,
});
export type DriveMember = z.infer<typeof DriveMemberSchema>;

export const DriveInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: MemberRoleSchema,
  invitedBy: PersonSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type DriveInvite = z.infer<typeof DriveInviteSchema>;

/** GET /api/workspaces/:id/people: everyone with access, and (owner only) the invitations still open. */
export const DrivePeopleResponse = z.object({
  members: z.array(DriveMemberSchema),
  invites: z.array(DriveInviteSchema),
});
export type DrivePeopleResponse = z.infer<typeof DrivePeopleResponse>;

export const InviteRequest = z.object({ email: z.string().trim().toLowerCase().email().max(320), role: MemberRoleSchema });
export type InviteRequest = z.infer<typeof InviteRequest>;

export const InviteResponse = z.object({ invite: DriveInviteSchema });
export type InviteResponse = z.infer<typeof InviteResponse>;

export const UpdateMemberRequest = z.object({ role: MemberRoleSchema });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

/** An invitation to someone else's drive, as the invitee sees it. */
export const InvitationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  role: MemberRoleSchema,
  invitedBy: PersonSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const InvitationListResponse = z.object({ invitations: z.array(InvitationSchema) });
export type InvitationListResponse = z.infer<typeof InvitationListResponse>;
