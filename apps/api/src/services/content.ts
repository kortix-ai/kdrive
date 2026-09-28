// STUB (FOUNDATION). Owner: API-files. Replace the bodies; keep the exported names and signatures.
import type { Context } from 'hono';
import { notImplemented } from '../lib/http';

/**
 * Streams one file (Range passthrough, ETag, nosniff, CSP; attachment for
 * downloads and active content). See architecture §6.4.
 */
export async function streamFile(
  c: Context,
  ws: { volumeId: string },
  path: string,
  opts: { at?: string; download?: boolean },
): Promise<Response> {
  throw notImplemented();
}

/** Streams a zip of `roots` (recursive, empty dirs as `name/`). See architecture §6.4. */
export async function streamZip(
  c: Context,
  ws: { volumeId: string },
  roots: string[],
  opts: { at?: string; zipName: string; relativeTo?: string },
): Promise<Response> {
  throw notImplemented();
}
