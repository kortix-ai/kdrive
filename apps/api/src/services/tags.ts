import { CHECKPOINT_TAG_PREFIX, LINK_TAG_PREFIX, TAG_BUDGET, type TagBudget } from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import type { WorkspaceCtx } from '../types';

export const checkpointTag = (id: string) => `${CHECKPOINT_TAG_PREFIX}${id}`;
export const linkTag = (id: string) => `${LINK_TAG_PREFIX}${id}`;

/** Tag usage of the workspace volume (checkpoints and pinned links share 100). */
export async function tagBudget(ws: Pick<WorkspaceCtx, 'volumeId'>): Promise<TagBudget> {
  const tags = await getStore().listTags(ws.volumeId);
  return {
    used: tags.length,
    max: TAG_BUDGET,
    checkpoints: tags.filter((t) => t.name.startsWith(CHECKPOINT_TAG_PREFIX)).length,
    pinnedLinks: tags.filter((t) => t.name.startsWith(LINK_TAG_PREFIX)).length,
  };
}

/** 409 `tag_budget_exceeded` when fewer than `need` tags are left. */
export async function assertTagBudget(ws: Pick<WorkspaceCtx, 'volumeId'>, need = 1): Promise<TagBudget> {
  const b = await tagBudget(ws);
  if (b.used + need > b.max) {
    throw new ApiError(409, 'tag_budget_exceeded', `All ${b.max} checkpoints and pinned links are in use. Remove one first.`, { ...b });
  }
  return b;
}
