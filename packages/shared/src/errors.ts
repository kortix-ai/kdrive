import { z } from 'zod';

export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'email_not_verified',
  'csrf',
  'not_found',
  'bad_request',
  'invalid_name',
  'invalid_path',
  'conflict',
  'path_exists',
  'path_not_found',
  'not_a_file',
  'not_a_directory',
  'quota_exceeded',
  'tag_budget_exceeded',
  'storage_limit',
  'version_gone',
  'rate_limited',
  'payload_too_large',
  'range_not_satisfiable',
  'link_expired',
  'link_revoked',
  'link_sign_in_required',
  'link_wrong_account',
  'link_password_required',
  'link_password_incorrect',
  'download_disabled',
  'upstream_unavailable',
  'not_implemented',
  'insufficient_scope',
  'stale_base',
  'proposal_closed',
  'read_only',
  'already_member',
  'too_many_people',
  'internal',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
