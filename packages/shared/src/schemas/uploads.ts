import { z } from 'zod';
import { MAX_PLAN_BLOCKS, MAX_PLAN_FILES } from '../constants';
import { ActionSummarySchema, PathSchema } from './common';

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lowercase sha256 hex digest.');

export const UploadPlanFile = z.object({
  path: PathSchema,
  size: z.number().int().min(0),
  blocks: z.array(Sha256HexSchema),
  /** unix ms */
  mtime: z.number().int().min(0).optional(),
});
export type UploadPlanFile = z.input<typeof UploadPlanFile>;

export const ConflictModeSchema = z.enum(['ask', 'keep-both', 'replace']);
export type ConflictMode = z.infer<typeof ConflictModeSchema>;

export const UploadPlanRequest = z
  .object({
    files: z.array(UploadPlanFile).max(MAX_PLAN_FILES),
    dirs: z.array(PathSchema).max(MAX_PLAN_FILES).default([]),
    conflict: ConflictModeSchema.default('ask'),
    /** Several plans of one user action (more than 10k files) share the action id. */
    actionId: z.string().max(64).optional(),
  })
  .refine((p) => p.files.reduce((n, f) => n + f.blocks.length, 0) <= MAX_PLAN_BLOCKS, {
    message: `A plan can hold at most ${MAX_PLAN_BLOCKS} blocks.`,
  })
  .refine((p) => p.files.length > 0 || p.dirs.length > 0, { message: 'A plan needs files or dirs.' });
export type UploadPlanRequest = z.input<typeof UploadPlanRequest>;

export const RenamedSchema = z.object({ from: z.string(), to: z.string() });

export const UploadPlanResponse = z.object({
  uploadId: z.string(),
  actionId: z.string(),
  missing: z.array(z.string()),
  renamed: z.array(RenamedSchema),
  expiresAt: z.string(),
});
export type UploadPlanResponse = z.infer<typeof UploadPlanResponse>;

/** `details` of a 409 `conflict` when conflict = 'ask'. */
export const UploadConflictDetails = z.object({ conflicts: z.array(z.string()) });
export type UploadConflictDetails = z.infer<typeof UploadConflictDetails>;

/** `details` of a 409 `conflict` when a commit still misses blocks. */
export const UploadMissingDetails = z.object({ missing: z.array(z.string()) });
export type UploadMissingDetails = z.infer<typeof UploadMissingDetails>;

/** `details` of a 413 `quota_exceeded`. */
export const QuotaDetails = z.object({
  usedBytes: z.number(),
  quotaBytes: z.number(),
  requestedBytes: z.number(),
  overBytes: z.number(),
});
export type QuotaDetails = z.infer<typeof QuotaDetails>;

export const UploadCommitResponse = z.object({ action: ActionSummarySchema, files: z.number() });
export type UploadCommitResponse = z.infer<typeof UploadCommitResponse>;
