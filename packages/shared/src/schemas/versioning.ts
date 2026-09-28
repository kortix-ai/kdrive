import { z } from 'zod';
import { ActionKindSchema, ActionSummarySchema, IsoDateSchema, PathOpSchema, PathSchema, RefSchema } from './common';

export const TimelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().max(128).optional(),
});
export type TimelineQuery = z.input<typeof TimelineQuery>;

export const TimelineEntryKindSchema = z.union([ActionKindSchema, z.enum(['external', 'init', 'fork'])]);
export type TimelineEntryKind = z.infer<typeof TimelineEntryKindSchema>;

export const TimelineEntrySchema = z.object({
  id: z.string(),
  commitId: z.string(),
  createdAt: IsoDateSchema,
  kind: TimelineEntryKindSchema,
  summary: z.string(),
  itemCount: z.number(),
  bytesDelta: z.number(),
  actor: z.object({ name: z.string().nullable(), email: z.string() }).nullable(),
  checkpoints: z.array(z.object({ id: z.string(), name: z.string() })),
  mergedCount: z.number(),
  isHead: z.boolean(),
  undoable: z.boolean(),
  actionId: z.string().nullable(),
  /** At most 5 entries (a preview). */
  paths: z.array(z.object({ op: PathOpSchema, path: z.string(), fromPath: z.string().nullable() })),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineResponse = z.object({
  entries: z.array(TimelineEntrySchema),
  nextCursor: z.string().nullable(),
  headCommitId: z.string(),
});
export type TimelineResponse = z.infer<typeof TimelineResponse>;

export const CommitResponse = z.object({
  id: z.string(),
  createdAt: IsoDateSchema,
  kind: z.string(),
  logicalBytes: z.number(),
  fileCount: z.number(),
  tags: z.array(z.string()),
  action: ActionSummarySchema.nullable(),
});
export type CommitResponse = z.infer<typeof CommitResponse>;

export const VersionsQuery = z.object({ path: PathSchema });
export type VersionsQuery = z.input<typeof VersionsQuery>;

export const FileVersionSchema = z.object({
  commitId: z.string(),
  createdAt: IsoDateSchema,
  size: z.number(),
  op: z.union([PathOpSchema, z.literal('unknown')]),
  actionId: z.string().nullable(),
  summary: z.string().nullable(),
  isCurrent: z.boolean(),
  checkpointNames: z.array(z.string()),
  /** The file's path at this version (an earlier name when it was renamed since). */
  path: z.string().optional(),
});
export type FileVersion = z.infer<typeof FileVersionSchema>;

export const VersionsResponse = z.object({
  path: z.string(),
  versions: z.array(FileVersionSchema),
  source: z.enum(['ledger', 'chain']),
});
export type VersionsResponse = z.infer<typeof VersionsResponse>;

export const CompareFileQuery = z.object({ path: PathSchema, a: RefSchema, b: RefSchema });
export type CompareFileQuery = z.input<typeof CompareFileQuery>;

export const FileSideSchema = z.object({
  commitId: z.string(),
  createdAt: IsoDateSchema,
  size: z.number(),
  mtime: z.number(),
  mime: z.string(),
  version: z.string().nullable(),
  contentUrl: z.string(),
  downloadUrl: z.string(),
});
export type FileSide = z.infer<typeof FileSideSchema>;

export const CompareKindSchema = z.enum(['text', 'image', 'csv', 'binary']);
export type CompareKind = z.infer<typeof CompareKindSchema>;

export const CompareFileResponse = z.object({
  path: z.string(),
  kind: CompareKindSchema,
  a: FileSideSchema.nullable(),
  b: FileSideSchema.nullable(),
  tooLargeForDiff: z.boolean(),
});
export type CompareFileResponse = z.infer<typeof CompareFileResponse>;

export const CompareDriveQuery = z.object({ a: RefSchema, b: RefSchema });
export type CompareDriveQuery = z.input<typeof CompareDriveQuery>;

export const DriveChangeSchema = z.object({
  op: z.enum(['added', 'removed', 'changed', 'moved']),
  path: z.string(),
  fromPath: z.string().optional(),
  type: z.enum(['file', 'dir']),
  sizeA: z.number().optional(),
  sizeB: z.number().optional(),
});
export type DriveChange = z.infer<typeof DriveChangeSchema>;

const CommitPoint = z.object({ commitId: z.string(), createdAt: IsoDateSchema });

export const CompareDriveResponse = z.object({
  a: CommitPoint,
  b: CommitPoint,
  changes: z.array(DriveChangeSchema),
  source: z.enum(['ledger', 'tree']),
});
export type CompareDriveResponse = z.infer<typeof CompareDriveResponse>;

export const RestoreScopeSchema = z.enum(['file', 'folder', 'drive']);
export type RestoreScope = z.infer<typeof RestoreScopeSchema>;

export const RestoreRequest = z
  .object({ scope: RestoreScopeSchema, path: PathSchema.optional(), at: RefSchema })
  .refine((r) => r.scope === 'drive' || !!r.path, { message: 'path is required for file and folder restores.' });
export type RestoreRequest = z.input<typeof RestoreRequest>;

export const RestoreResponse = z.object({
  action: ActionSummarySchema,
  /** Drive restores: the automatic "Before restore" checkpoint. */
  checkpoint: z.object({ id: z.string(), name: z.string() }).optional(),
  checkpointSkipped: z.boolean().optional(),
});
export type RestoreResponse = z.infer<typeof RestoreResponse>;

export const UndoResponse = z.object({ action: ActionSummarySchema });
export type UndoResponse = z.infer<typeof UndoResponse>;

export const DeletedQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) });
export type DeletedQuery = z.input<typeof DeletedQuery>;

export const DeletedItemSchema = z.object({
  actionId: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number(),
  deletedAt: IsoDateSchema,
  restoreAt: z.string().nullable(),
  restorable: z.boolean(),
});
export type DeletedItem = z.infer<typeof DeletedItemSchema>;

export const DeletedResponse = z.object({ items: z.array(DeletedItemSchema) });
export type DeletedResponse = z.infer<typeof DeletedResponse>;
