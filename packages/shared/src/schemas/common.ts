import { z } from 'zod';
import { normalizePath, PathError } from '../paths';

/** A drive path from the client. Normalised (NFC, absolute, no trailing slash); invalid input is a zod issue. */
export const PathSchema = z.string().max(8192).transform((v, ctx) => {
  try {
    return normalizePath(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof PathError ? e.message : 'Invalid path.' });
    return z.NEVER;
  }
});

/** A path as the server spells it in responses (already normalised). */
export const PathOutSchema = z.string();

/** A version ref: commit id (`vc_…`), tag name or `head`. */
export const RefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'Invalid version reference.');
export type Ref = z.infer<typeof RefSchema>;

/** Our ids: lowercase ULID (26 chars). better-auth user ids are accepted too (any url-safe token). */
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id.');

export const IsoDateSchema = z.string();

export const EntryTypeSchema = z.enum(['file', 'dir', 'symlink', 'other']);
export type EntryType = z.infer<typeof EntryTypeSchema>;

export const FileEntrySchema = z.object({
  path: PathOutSchema,
  name: z.string(),
  type: EntryTypeSchema,
  size: z.number(),
  /** unix ms */
  mtime: z.number(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const FileStatSchema = FileEntrySchema.extend({
  mode: z.number(),
  /** ULID of the commit that last wrote this entry (`vc_` + version is that commit). */
  version: z.string().nullable(),
  commitId: z.string(),
});
export type FileStat = z.infer<typeof FileStatSchema>;

export const ACTION_KINDS = [
  'upload',
  'folder.create',
  'rename',
  'move',
  'copy',
  'delete',
  'restore.file',
  'restore.folder',
  'restore.drive',
  'undo',
  'agent.batch',
  'proposal.accept',
] as const;
export const ActionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const PATH_OPS = ['added', 'changed', 'deleted', 'moved', 'copied', 'restored'] as const;
export const PathOpSchema = z.enum(PATH_OPS);
export type PathOp = z.infer<typeof PathOpSchema>;

export const ActionStatusSchema = z.enum(['pending', 'committed', 'noop', 'failed']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/** Who acted, when an AI agent made the change. `credential` is `pat:<tokenId>` or `oauth:<clientId>`. */
export const AgentRefSchema = z.object({
  kind: z.enum(['token', 'oauth']),
  name: z.string(),
  credential: z.string(),
});
export type AgentRef = z.infer<typeof AgentRefSchema>;

export const ActionSummarySchema = z.object({
  id: z.string(),
  kind: ActionKindSchema,
  summary: z.string(),
  status: ActionStatusSchema,
  headCommitId: z.string().nullable(),
  baseCommitId: z.string().nullable(),
  createdAt: IsoDateSchema,
  itemCount: z.number(),
  bytesDelta: z.number(),
  undoable: z.boolean(),
  /** Restores: when the version it went back to was made (the client shows it in local time). */
  restoredTo: IsoDateSchema.nullable().optional(),
  /** Set when an AI agent made the change (directly, or through an accepted proposal). */
  agent: AgentRefSchema.nullable().optional(),
  /** The proposal this action accepted. */
  proposalId: z.string().nullable().optional(),
});
export type ActionSummary = z.infer<typeof ActionSummarySchema>;

export const MutationResponse = z.object({ action: ActionSummarySchema });
export type MutationResponse = z.infer<typeof MutationResponse>;

export const PageCursorSchema = z.string().max(512).nullable();

/** Query-string boolean flag: `?download=1`. */
export const FlagSchema = z.enum(['1', 'true', '0', 'false']).optional();

/** Empty JSON body (`{}`) for POSTs that take no input. */
export const EmptyBody = z.object({}).passthrough();
