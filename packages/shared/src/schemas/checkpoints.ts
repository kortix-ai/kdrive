import { z } from 'zod';
import { IsoDateSchema, RefSchema } from './common';

export const TagBudgetSchema = z.object({
  used: z.number(),
  max: z.number(),
  checkpoints: z.number(),
  pinnedLinks: z.number(),
});
export type TagBudget = z.infer<typeof TagBudgetSchema>;

export const CheckpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string(),
  commitId: z.string(),
  createdAt: IsoDateSchema,
  auto: z.boolean(),
  logicalBytes: z.number(),
  fileCount: z.number(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const CheckpointListResponse = z.object({
  checkpoints: z.array(CheckpointSchema),
  budget: TagBudgetSchema,
});
export type CheckpointListResponse = z.infer<typeof CheckpointListResponse>;

export const CreateCheckpointRequest = z.object({
  name: z.string().trim().min(1).max(80),
  note: z.string().max(500).optional(),
  at: RefSchema.optional(),
});
export type CreateCheckpointRequest = z.input<typeof CreateCheckpointRequest>;

export const UpdateCheckpointRequest = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((r) => r.name !== undefined || r.note !== undefined, { message: 'Nothing to update.' });
export type UpdateCheckpointRequest = z.input<typeof UpdateCheckpointRequest>;

export const CheckpointResponse = z.object({ checkpoint: CheckpointSchema });
export type CheckpointResponse = z.infer<typeof CheckpointResponse>;
