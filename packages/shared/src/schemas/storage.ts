import { z } from 'zod';
import { STORAGE_CATEGORIES } from '../mime';
import { MeterLevelSchema } from './me';
import { DriveRoleSchema, PersonSchema } from './workspaces';

export const StorageCategorySchema = z.enum(STORAGE_CATEGORIES);

/** Current files of one group: their bytes (file sizes) and how many there are. */
export const CategoryUsageSchema = z.object({ category: StorageCategorySchema, bytes: z.number(), files: z.number() });
export type CategoryUsage = z.infer<typeof CategoryUsageSchema>;

export const StorageFileSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  path: z.string(),
  size: z.number(),
  category: StorageCategorySchema,
});
export type StorageFile = z.infer<typeof StorageFileSchema>;

export const DriveStorageSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  /** What the quota counts for this drive (the volume's logical size: files in 4 KiB pages, plus folders). */
  bytes: z.number(),
  /** Sum of the current files' sizes. */
  fileBytes: z.number(),
  files: z.number(),
  categories: z.array(CategoryUsageSchema),
  /** People other than the owner (members). */
  members: z.number(),
  /** The drive was too big to list in full: its numbers cover the first part only. */
  partial: z.boolean(),
});
export type DriveStorage = z.infer<typeof DriveStorageSchema>;

/**
 * Content that earlier versions keep restorable: what was replaced or deleted in the
 * retention window, from the change ledger. Real file sizes, before any sharing of
 * unchanged data between versions, and not counted in the quota.
 */
export const HistoryUsageSchema = z.object({
  windowDays: z.number(),
  replacedBytes: z.number(),
  replacedFiles: z.number(),
  deletedBytes: z.number(),
  /** Top-level items deleted (a deleted folder is one item; its bytes are everything it held). */
  deletedItems: z.number(),
});
export type HistoryUsage = z.infer<typeof HistoryUsageSchema>;

/** GET /api/me/storage: the signed-in user's own drives. */
export const StorageOverviewResponse = z.object({
  quotaBytes: z.number(),
  usedBytes: z.number(),
  level: MeterLevelSchema,
  fileBytes: z.number(),
  files: z.number(),
  categories: z.array(CategoryUsageSchema),
  drives: z.array(DriveStorageSchema),
  /** The biggest current files across the drives, biggest first. */
  largest: z.array(StorageFileSchema),
  history: HistoryUsageSchema,
  partial: z.boolean(),
});
export type StorageOverviewResponse = z.infer<typeof StorageOverviewResponse>;

/** One person's share of a drive. `former`: no longer has access, but their files are still there. */
export const StoragePersonSchema = z.object({
  person: PersonSchema,
  role: z.union([DriveRoleSchema, z.literal('former')]),
  bytes: z.number(),
  files: z.number(),
  /** Of `bytes`: what AI agents acting for this person wrote. */
  agentBytes: z.number(),
});
export type StoragePerson = z.infer<typeof StoragePersonSchema>;

/** GET /api/w/:ws/storage/people: who the current files of a drive came from. */
export const StoragePeopleResponse = z.object({
  workspaceId: z.string(),
  name: z.string(),
  /** The version the numbers describe. */
  commitId: z.string(),
  fileBytes: z.number(),
  files: z.number(),
  /** Biggest share first; everyone with access is listed, with 0 when they wrote nothing that is still there. */
  people: z.array(StoragePersonSchema),
  /** Files with no recorded writer (a duplicated drive's original content, or changes made outside KDRIVE). */
  untracked: z.object({ bytes: z.number(), files: z.number() }),
  /** The drive or its history was too big to read in full: the numbers cover part of it. */
  partial: z.boolean(),
});
export type StoragePeopleResponse = z.infer<typeof StoragePeopleResponse>;
