'use client';

import { mutate } from 'swr';
import type { MeResponse } from '@volumes/shared';
import { vx } from '@/lib/store';

/**
 * Makes `id` the current workspace after it was created or duplicated:
 * reloads `me` first (so the store knows the new workspace), then switches.
 */
export async function switchToWorkspace(id: string): Promise<void> {
  const me = await mutate<MeResponse>('me');
  if (me) vx().setMe(me);
  vx().setWorkspace(id);
  void mutate('workspaces');
}
