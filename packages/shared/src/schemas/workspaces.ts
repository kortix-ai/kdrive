import { z } from 'zod';
import { IsoDateSchema, RefSchema } from './common';

const WorkspaceName = z.string().trim().min(1).max(60);

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
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
