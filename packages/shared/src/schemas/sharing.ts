import { z } from 'zod';
import { FileEntrySchema, FlagSchema, IsoDateSchema, PathSchema, RefSchema } from './common';

export const LinkModeSchema = z.enum(['live', 'pinned']);
export type LinkMode = z.infer<typeof LinkModeSchema>;

export const ShareLinkSchema = z.object({
  id: z.string(),
  /** Absolute: `<BETTER_AUTH_URL>/s/<token>` */
  url: z.string(),
  token: z.string(),
  path: z.string(),
  targetType: z.enum(['file', 'dir']),
  mode: LinkModeSchema,
  commitId: z.string().nullable(),
  expiresAt: IsoDateSchema.nullable(),
  revokedAt: IsoDateSchema.nullable(),
  openCount: z.number(),
  lastOpenedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type ShareLink = z.infer<typeof ShareLinkSchema>;

export const CreateLinkRequest = z.object({
  path: PathSchema,
  mode: LinkModeSchema,
  /** pinned: defaults to head */
  at: RefSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CreateLinkRequest = z.input<typeof CreateLinkRequest>;

export const UpdateLinkRequest = z.object({
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type UpdateLinkRequest = z.input<typeof UpdateLinkRequest>;

export const LinkListQuery = z.object({ path: PathSchema.optional() });
export type LinkListQuery = z.input<typeof LinkListQuery>;

export const LinkListResponse = z.object({ links: z.array(ShareLinkSchema) });
export type LinkListResponse = z.infer<typeof LinkListResponse>;

export const LinkResponse = z.object({ link: ShareLinkSchema });
export type LinkResponse = z.infer<typeof LinkResponse>;

export const PublicShareMeta = z.object({
  name: z.string(),
  targetType: z.enum(['file', 'dir']),
  mode: LinkModeSchema,
  pinnedAt: IsoDateSchema.nullable(),
  commitId: z.string().nullable(),
  expiresAt: IsoDateSchema.nullable(),
  ownerName: z.string().nullable(),
  size: z.number().optional(),
  mime: z.string().optional(),
});
export type PublicShareMeta = z.infer<typeof PublicShareMeta>;

/** `path` is relative to the link root. */
export const PublicListQuery = z.object({ path: PathSchema.default('/') });
export type PublicListQuery = z.input<typeof PublicListQuery>;

export const PublicListResponse = z.object({
  path: z.string(),
  /** paths relative to the link root */
  entries: z.array(FileEntrySchema),
});
export type PublicListResponse = z.infer<typeof PublicListResponse>;

export const PublicContentQuery = z.object({ path: PathSchema.default('/'), download: FlagSchema });
export type PublicContentQuery = z.input<typeof PublicContentQuery>;

export const PublicZipQuery = z.object({ path: PathSchema.default('/') });
export type PublicZipQuery = z.input<typeof PublicZipQuery>;
