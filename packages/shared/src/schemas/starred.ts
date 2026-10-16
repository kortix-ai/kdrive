import { z } from 'zod';
import { IdSchema, IsoDateSchema, PathOutSchema, PathSchema } from './common';

// ── Starred ─────────────────────────────────────────────────────────────────

/** One starred item, in any drive the signed-in user can open. */
export const StarredItemSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  path: PathOutSchema,
  name: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number(),
  /** unix ms */
  mtime: z.number(),
  starredAt: IsoDateSchema,
});
export type StarredItem = z.infer<typeof StarredItemSchema>;

/** GET /api/stars: newest star first. */
export const StarredListResponse = z.object({ items: z.array(StarredItemSchema) });
export type StarredListResponse = z.infer<typeof StarredListResponse>;

/** GET /api/w/:ws/stars, and the answer to POST /api/stars: the starred paths of one drive. */
export const DriveStarsResponse = z.object({ paths: z.array(PathOutSchema) });
export type DriveStarsResponse = z.infer<typeof DriveStarsResponse>;

/** POST /api/stars: star or unstar items of one drive (any member, viewers too). */
export const SetStarsRequest = z.object({
  workspaceId: IdSchema,
  paths: z.array(PathSchema).min(1).max(1000),
  starred: z.boolean(),
});
export type SetStarsRequest = z.input<typeof SetStarsRequest>;

// ── Recent ──────────────────────────────────────────────────────────────────

/** Why a file is in Recent: the user opened it, or changed it (upload, edit, rename, move…). */
export const RecentReasonSchema = z.enum(['opened', 'edited']);
export type RecentReason = z.infer<typeof RecentReasonSchema>;

export const RecentItemSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  path: PathOutSchema,
  name: z.string(),
  size: z.number(),
  /** unix ms */
  mtime: z.number(),
  /** When the user last opened or changed it. */
  at: IsoDateSchema,
  reason: RecentReasonSchema,
});
export type RecentItem = z.infer<typeof RecentItemSchema>;

export const RecentQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
export type RecentQuery = z.input<typeof RecentQuery>;

/** GET /api/recent: newest first. */
export const RecentListResponse = z.object({ items: z.array(RecentItemSchema) });
export type RecentListResponse = z.infer<typeof RecentListResponse>;

/** POST /api/recent/opened: the user previewed or downloaded a file. */
export const RecordOpenRequest = z.object({ workspaceId: IdSchema, path: PathSchema });
export type RecordOpenRequest = z.input<typeof RecordOpenRequest>;
