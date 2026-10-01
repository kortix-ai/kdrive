import { signOut } from './auth-client';
import { clearSwrCache } from './api/swr';
import { useVx } from './store';
import { endUploads } from './upload/uploads';
import { resetUploadPrompts } from './upload/prompts';

/**
 * Forgets the signed-in user's state in this tab (sign-out, account deletion): running and
 * queued uploads are cancelled, the upload tray and its questions close, every store slice
 * that belongs to the user resets, and every cached response (plain, paged and subscription
 * keys) is dropped. The only way the app ends a session.
 */
export async function endSession(): Promise<void> {
  endUploads();
  resetUploadPrompts();
  useVx.getState().setMe(null);
  await clearSwrCache();
}

/** Signs out on the server (best effort), then forgets the user in this tab. */
export async function signOutAndEnd(): Promise<void> {
  await signOut().catch(() => {});
  await endSession();
}
