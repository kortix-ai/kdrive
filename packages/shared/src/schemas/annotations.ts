// Comments on files and the drive's tags ("labels" in code: `tags` already means
// volume tags, the checkpoints and pinned links that keep versions).
import { z } from 'zod';
import { FileEntrySchema, IdSchema, IsoDateSchema, PathOutSchema, PathSchema } from './common';

export const MAX_COMMENT_CHARS = 4000;
export const MAX_LABEL_NAME_CHARS = 32;
export const MAX_LABELS_PER_DRIVE = 100;
/** How many items one assign / unassign call may name. */
export const MAX_LABEL_PATHS = 500;

/** The fixed tag palette; the web maps each to its --vx-label-* tokens. */
export const LABEL_COLORS = ['slate', 'sage', 'moss', 'sand', 'clay', 'rose', 'plum', 'sky'] as const;
export const LabelColorSchema = z.enum(LABEL_COLORS);
export type LabelColor = z.infer<typeof LabelColorSchema>;

// ── comments ────────────────────────────────────────────────────────────────

export const CommentAuthorSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const FileCommentSchema = z.object({
  id: z.string(),
  path: PathOutSchema,
  /** The thread's first comment; null for a thread root. */
  parentId: z.string().nullable(),
  author: CommentAuthorSchema,
  body: z.string(),
  /** The drive version (commit id) the comment was written on. */
  commitId: z.string().nullable(),
  /** When that version was made (null when unknown). */
  commitAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  editedAt: IsoDateSchema.nullable(),
  resolvedAt: IsoDateSchema.nullable(),
  resolvedBy: z.string().nullable(),
  /** The session user may edit it (their own). */
  canEdit: z.boolean(),
  /** The session user may delete it (their own, or anything for the drive owner). */
  canDelete: z.boolean(),
});
export type FileComment = z.infer<typeof FileCommentSchema>;

const CommentBody = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, '\n').trim())
  .pipe(z.string().min(1, 'Write something first.').max(MAX_COMMENT_CHARS, `At most ${MAX_COMMENT_CHARS} characters.`));

export const CommentListQuery = z.object({ path: PathSchema });
export type CommentListQuery = z.input<typeof CommentListQuery>;

export const CommentListResponse = z.object({ comments: z.array(FileCommentSchema) });
export type CommentListResponse = z.infer<typeof CommentListResponse>;

export const CreateCommentRequest = z.object({
  path: PathSchema,
  body: CommentBody,
  /** Replying to this thread (its root, or any comment in it). */
  parentId: IdSchema.optional(),
});
export type CreateCommentRequest = z.input<typeof CreateCommentRequest>;

export const UpdateCommentRequest = z.object({
  body: CommentBody.optional(),
  /** Thread roots: resolve (true) or reopen (false). */
  resolved: z.boolean().optional(),
});
export type UpdateCommentRequest = z.input<typeof UpdateCommentRequest>;

export const CommentResponse = z.object({ comment: FileCommentSchema });
export type CommentResponse = z.infer<typeof CommentResponse>;

/** Per file with comments: how many, and how many threads are still open. */
export const CommentCountSchema = z.object({ path: PathOutSchema, count: z.number(), open: z.number() });
export type CommentCount = z.infer<typeof CommentCountSchema>;

export const CommentCountsResponse = z.object({ counts: z.array(CommentCountSchema) });
export type CommentCountsResponse = z.infer<typeof CommentCountsResponse>;

// ── labels (tags in the UI) ─────────────────────────────────────────────────

export const FileLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: LabelColorSchema,
  /** Items carrying it now. */
  count: z.number(),
  createdAt: IsoDateSchema,
});
export type FileLabel = z.infer<typeof FileLabelSchema>;

/** The labels on one item, by id. */
export const LabelAssignmentSchema = z.object({ path: PathOutSchema, labelIds: z.array(z.string()) });
export type LabelAssignment = z.infer<typeof LabelAssignmentSchema>;

export const LabelListResponse = z.object({
  labels: z.array(FileLabelSchema),
  assignments: z.array(LabelAssignmentSchema),
});
export type LabelListResponse = z.infer<typeof LabelListResponse>;

const LabelName = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Name the tag.').max(MAX_LABEL_NAME_CHARS, `At most ${MAX_LABEL_NAME_CHARS} characters.`));

export const CreateLabelRequest = z.object({ name: LabelName, color: LabelColorSchema });
export type CreateLabelRequest = z.input<typeof CreateLabelRequest>;

export const UpdateLabelRequest = z.object({ name: LabelName.optional(), color: LabelColorSchema.optional() });
export type UpdateLabelRequest = z.input<typeof UpdateLabelRequest>;

/** The items carrying one label now, across the drive (the drive view's tag filter). */
export const LabelItemsResponse = z.object({ items: z.array(FileEntrySchema) });
export type LabelItemsResponse = z.infer<typeof LabelItemsResponse>;

export const LabelResponse = z.object({ label: FileLabelSchema });
export type LabelResponse = z.infer<typeof LabelResponse>;

/** Puts a label on (or takes it off) every named item. */
export const AssignLabelRequest = z.object({
  labelId: IdSchema,
  paths: z.array(PathSchema).min(1).max(MAX_LABEL_PATHS),
  assigned: z.boolean(),
});
export type AssignLabelRequest = z.input<typeof AssignLabelRequest>;
