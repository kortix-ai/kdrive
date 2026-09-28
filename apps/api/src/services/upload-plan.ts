// STUB (FOUNDATION). Owner: API-files. Replace the bodies; keep the exported names and signatures.
import type { z } from 'zod';
import type { UploadPlanRequest } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { UploadPlan } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import type { PathChange } from './ledger';

export type ResolvedUploadPlan = {
  plan: UploadPlan;
  renamed: { from: string; to: string }[];
  changes: PathChange[];
  totalBytes: number;
};

/** Validates a browser plan, resolves conflicts (ask / keep-both / replace) against head. */
export async function resolveUploadPlan(ws: WorkspaceCtx, req: z.output<typeof UploadPlanRequest>): Promise<ResolvedUploadPlan> {
  throw notImplemented();
}
