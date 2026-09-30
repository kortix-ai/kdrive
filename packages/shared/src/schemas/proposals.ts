import { z } from 'zod';
import { ActionSummarySchema, AgentRefSchema, IsoDateSchema } from './common';
import { CompareKindSchema, FileSideSchema } from './versioning';

export const ProposalStatusSchema = z.enum(['open', 'accepted', 'partial', 'discarded', 'expired']);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalOpKindSchema = z.enum(['write', 'mkdir', 'move', 'copy', 'delete']);
export type ProposalOpKind = z.infer<typeof ProposalOpKindSchema>;

export const ProposalFileStatusSchema = z.enum(['pending', 'accepted', 'discarded']);
export type ProposalFileStatus = z.infer<typeof ProposalFileStatusSchema>;

/** How a proposed op reads to the user: write → added / modified, delete → removed, mkdir → folder. */
export const ProposalChangeSchema = z.enum(['added', 'modified', 'removed', 'moved', 'copied', 'folder']);
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

export const ProposalCountsSchema = z.object({
  added: z.number(),
  modified: z.number(),
  removed: z.number(),
  moved: z.number(),
  copied: z.number(),
  folders: z.number(),
});
export type ProposalCounts = z.infer<typeof ProposalCountsSchema>;

export const ProposalSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agent: AgentRefSchema,
  message: z.string(),
  status: ProposalStatusSchema,
  createdAt: IsoDateSchema,
  decidedAt: IsoDateSchema.nullable(),
  baseCommitId: z.string(),
  opCount: z.number(),
  bytesTotal: z.number(),
  counts: ProposalCountsSchema,
  /** Ops still waiting for a decision. */
  pending: z.number(),
  /** Browser URL of the review page. */
  url: z.string(),
});
export type ProposalSummary = z.infer<typeof ProposalSummarySchema>;

export const ProposalListQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Id cursor: proposals older than this one. */
  before: z.string().max(64).optional(),
});
export type ProposalListQuery = z.input<typeof ProposalListQuery>;

export const ProposalListResponse = z.object({
  proposals: z.array(ProposalSummarySchema),
  nextCursor: z.string().nullable(),
  openCount: z.number(),
});
export type ProposalListResponse = z.infer<typeof ProposalListResponse>;

export const ProposalCountResponse = z.object({ open: z.number() });
export type ProposalCountResponse = z.infer<typeof ProposalCountResponse>;

export const ProposalConflictSchema = z.object({
  reason: z.enum(['changed', 'created', 'deleted', 'type']),
  currentSize: z.number().nullable(),
});
export type ProposalConflict = z.infer<typeof ProposalConflictSchema>;

export const ProposalFileSchema = z.object({
  seq: z.number(),
  op: ProposalOpKindSchema,
  change: ProposalChangeSchema,
  path: z.string(),
  fromPath: z.string().nullable(),
  entryType: z.enum(['file', 'dir']),
  size: z.number().nullable(),
  baseSize: z.number().nullable(),
  mime: z.string().nullable(),
  status: ProposalFileStatusSchema,
  /** Pending rows only: the path changed in the drive since the agent read it. */
  conflict: ProposalConflictSchema.nullable(),
  /** write and delete rows: `a` = now, `b` = proposed (commitId 'proposed'). */
  compare: z
    .object({
      kind: CompareKindSchema,
      a: FileSideSchema.nullable(),
      b: FileSideSchema.nullable(),
      tooLargeForDiff: z.boolean(),
    })
    .nullable(),
  /** Pending rows: the waiting rows this one builds on (accepting it accepts them too). */
  requires: z.array(z.number()).optional(),
  /** What the drive holds now: the path itself, the source of a move / copy, the folder the path is in. */
  inDrive: z.object({ path: z.boolean(), from: z.boolean().nullable(), folder: z.boolean() }).optional(),
});
export type ProposalFile = z.infer<typeof ProposalFileSchema>;

export const ProposalDetailResponse = z.object({
  proposal: ProposalSummarySchema,
  files: z.array(ProposalFileSchema),
  headCommitId: z.string(),
  conflicts: z.number(),
});
export type ProposalDetailResponse = z.infer<typeof ProposalDetailResponse>;

export const AcceptProposalRequest = z.object({
  /** Default: every pending op. */
  seqs: z.array(z.number().int().min(0)).min(1).max(1000).optional(),
  /** Accept even when the drive changed since the agent read it. */
  force: z.boolean().default(false),
});
export type AcceptProposalRequest = z.input<typeof AcceptProposalRequest>;

export const AcceptProposalResponse = z.object({
  proposal: ProposalSummarySchema,
  action: ActionSummarySchema.nullable(),
});
export type AcceptProposalResponse = z.infer<typeof AcceptProposalResponse>;

export const DiscardProposalRequest = z.object({
  /** Default: every pending op. */
  seqs: z.array(z.number().int().min(0)).min(1).max(1000).optional(),
});
export type DiscardProposalRequest = z.input<typeof DiscardProposalRequest>;

export const DiscardProposalResponse = z.object({ proposal: ProposalSummarySchema });
export type DiscardProposalResponse = z.infer<typeof DiscardProposalResponse>;

export const ProposalContentQuery = z.object({ download: z.literal('1').optional() });
export type ProposalContentQuery = z.input<typeof ProposalContentQuery>;
