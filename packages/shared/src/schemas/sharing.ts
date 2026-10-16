import { z } from 'zod';
import { UPLOAD_LINK_FILE_MAX, UPLOAD_LINK_MAX_FILES } from '../constants';
import { FileEntrySchema, FlagSchema, IsoDateSchema, PathSchema, RefSchema } from './common';

export const LinkModeSchema = z.enum(['live', 'pinned']);
export type LinkMode = z.infer<typeof LinkModeSchema>;

/** `view`: people open and download. `upload`: people send files into a folder (always live). */
export const LinkKindSchema = z.enum(['view', 'upload']);
export type LinkKind = z.infer<typeof LinkKindSchema>;

export const ShareLinkSchema = z.object({
  id: z.string(),
  kind: LinkKindSchema,
  /** Absolute: `<BETTER_AUTH_URL>/s/<token>` (an upload link: `/u/<token>`) */
  url: z.string(),
  token: z.string(),
  path: z.string(),
  targetType: z.enum(['file', 'dir']),
  mode: LinkModeSchema,
  commitId: z.string().nullable(),
  expiresAt: IsoDateSchema.nullable(),
  revokedAt: IsoDateSchema.nullable(),
  /** Set when the shared item was deleted: the link no longer opens (undoing the delete brings it back). */
  detachedAt: IsoDateSchema.nullable().optional(),
  openCount: z.number(),
  lastOpenedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  /** A password is set (the password itself never leaves the server). */
  hasPassword: z.boolean(),
  /** false: view only, the public page offers no downloads and the API refuses them. */
  allowDownload: z.boolean(),
  /** Lower-cased; empty = anyone with the link. */
  allowedEmails: z.array(z.string()),
  /** Upload links: the per-file size limit (null = the server cap) and the file limit (null = none). */
  maxFileBytes: z.number().nullable().optional(),
  maxFiles: z.number().nullable().optional(),
  /** Upload links: files received so far and their bytes. */
  uploadCount: z.number().optional(),
  uploadBytes: z.number().optional(),
});
export type ShareLink = z.infer<typeof ShareLinkSchema>;

/** Most addresses one link can be limited to. */
export const LINK_EMAILS_MAX = 50;
export const LINK_PASSWORD_MIN = 4;
export const LINK_PASSWORD_MAX = 128;

export const LinkPasswordSchema = z.string().min(LINK_PASSWORD_MIN).max(LINK_PASSWORD_MAX);
/** Trimmed, lower-cased and de-duplicated. */
export const LinkEmailsSchema = z
  .array(z.string().trim().toLowerCase().pipe(z.string().email().max(254)))
  .max(LINK_EMAILS_MAX)
  .transform((list) => [...new Set(list)]);

export const CreateLinkRequest = z.object({
  path: PathSchema,
  mode: LinkModeSchema,
  /** pinned: defaults to head */
  at: RefSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  password: LinkPasswordSchema.nullable().optional(),
  allowDownload: z.boolean().optional(),
  allowedEmails: LinkEmailsSchema.optional(),
  /** `upload` needs a folder and mode `live`. */
  kind: LinkKindSchema.optional(),
  maxFileBytes: z.number().int().min(1).max(UPLOAD_LINK_FILE_MAX).nullable().optional(),
  maxFiles: z.number().int().min(1).max(UPLOAD_LINK_MAX_FILES).nullable().optional(),
});
export type CreateLinkRequest = z.input<typeof CreateLinkRequest>;

/** Every field is optional: absent = unchanged. `password: null` removes it, `allowedEmails: []` opens the link to anyone. */
export const UpdateLinkRequest = z.object({
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  password: LinkPasswordSchema.nullable().optional(),
  allowDownload: z.boolean().optional(),
  allowedEmails: LinkEmailsSchema.optional(),
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
  /** false: previews only, no download or zip. */
  allowDownload: z.boolean(),
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

export const PublicUnlockRequest = z.object({ password: z.string().min(1).max(LINK_PASSWORD_MAX) });
export type PublicUnlockRequest = z.input<typeof PublicUnlockRequest>;
/** The public page of an upload link: where files go, and what it still accepts. */
export const PublicUploadMeta = z.object({
  /** The folder's name (the drive name for the top folder). */
  name: z.string(),
  ownerName: z.string().nullable(),
  expiresAt: IsoDateSchema.nullable(),
  /** Bytes per file this link accepts. */
  maxFileBytes: z.number(),
  /** Files it still accepts (null = no file limit on the link). */
  remainingFiles: z.number().nullable(),
});
export type PublicUploadMeta = z.infer<typeof PublicUploadMeta>;

/** One file received through an upload link. Never names what else is in the folder. */
export const PublicUploadResponse = z.object({ name: z.string(), size: z.number() });
export type PublicUploadResponse = z.infer<typeof PublicUploadResponse>;
