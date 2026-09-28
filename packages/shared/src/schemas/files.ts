import { z } from 'zod';
import { FileEntrySchema, FileStatSchema, FlagSchema, PathSchema, RefSchema } from './common';

export const ListQuery = z.object({
  path: PathSchema.default('/'),
  at: RefSchema.optional(),
});
export type ListQuery = z.input<typeof ListQuery>;

export const ListResponse = z.object({
  path: z.string(),
  commitId: z.string(),
  entries: z.array(FileEntrySchema),
});
export type ListResponse = z.infer<typeof ListResponse>;

export const StatQuery = z.object({ path: PathSchema, at: RefSchema.optional() });
export type StatQuery = z.input<typeof StatQuery>;

export const StatResponse = FileStatSchema;
export type StatResponse = z.infer<typeof StatResponse>;

export const ContentQuery = z.object({
  path: PathSchema,
  at: RefSchema.optional(),
  download: FlagSchema,
});
export type ContentQuery = z.input<typeof ContentQuery>;

/** `?paths=/a&paths=/b` (a single value is accepted too). */
export const ZipQuery = z.object({
  paths: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(PathSchema).min(1).max(1000)),
  at: RefSchema.optional(),
  name: z.string().max(200).optional(),
});
export type ZipQuery = z.input<typeof ZipQuery>;

export const CreateFolderRequest = z.object({ path: PathSchema });
export type CreateFolderRequest = z.input<typeof CreateFolderRequest>;

const MoveItem = z.object({ from: PathSchema, to: PathSchema });

export const MoveRequest = z.object({
  items: z.array(MoveItem).min(1).max(1000),
  overwrite: z.boolean().optional(),
});
export type MoveRequest = z.input<typeof MoveRequest>;

export const CopyRequest = z.object({
  items: z.array(MoveItem).min(1).max(1000),
  overwrite: z.boolean().optional(),
});
export type CopyRequest = z.input<typeof CopyRequest>;

export const DeleteRequest = z.object({ paths: z.array(PathSchema).min(1).max(1000) });
export type DeleteRequest = z.input<typeof DeleteRequest>;

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  at: RefSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type SearchQuery = z.input<typeof SearchQuery>;

export const SearchResponse = z.object({
  commitId: z.string(),
  results: z.array(FileEntrySchema),
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
