/**
 * The listing useListing shows: `data` unless it was fetched for another workspace than
 * `ws`. SWR's keepPreviousData hands back the last key's data while the next key loads (or
 * fails); across a workspace switch that is the OLD workspace's folder, whose rows (and
 * their delete / rename / move) would then target the new workspace.
 * `dataWs`: the workspace `data` was fetched for.
 */
export function listingFor<T>(data: T | undefined, dataWs: string | null, ws: string | null): T | undefined {
  return data !== undefined && ws !== null && dataWs === ws ? data : undefined;
}
