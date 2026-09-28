// Files: listing, stat, content (Range), zip, folders, move / rename / copy,
// delete, search. Workspace comes from the session (requireWorkspace); a raw
// volume id is never accepted. Mutations never take `at`.
import { Hono } from 'hono';
import {
  basename,
  ContentQuery,
  CopyRequest,
  CreateFolderRequest,
  DeleteRequest,
  ListQuery,
  ListResponse,
  MoveRequest,
  MutationResponse,
  SearchQuery,
  SearchResponse,
  StatQuery,
  StatResponse,
  ZipQuery,
} from '@volumes/shared';
import { ok, parseJson, parseQuery } from '../lib/http';
import { streamFile, streamZip } from '../services/content';
import { copyPaths, createFolder, deletePaths, movePaths, sortEntries } from '../services/files-ops';
import { searchFiles } from '../services/search';
import { listDir } from '../services/tree';
import { getStore } from '../storage';
import type { AppEnv } from '../types';

export const filesRoutes = new Hono<AppEnv>();

const isFlag = (v: string | undefined) => v === '1' || v === 'true';

filesRoutes.get('/files', async (c) => {
  const q = parseQuery(c, ListQuery);
  const ws = c.get('ws');
  const { commitId, entries } = await listDir(ws, q.path, q.at);
  const out = sortEntries(
    entries.map((e) => ({ path: e.path, name: e.name || basename(e.path), type: e.type, size: e.size, mtime: e.mtime })),
  );
  return ok(c, ListResponse, { path: q.path, commitId, entries: out });
});

filesRoutes.get('/files/stat', async (c) => {
  const q = parseQuery(c, StatQuery);
  const st = await getStore().stat(c.get('ws').volumeId, q.path, { at: q.at });
  return ok(c, StatResponse, {
    path: st.path,
    name: st.name || basename(st.path),
    type: st.type,
    size: st.size,
    mtime: st.mtime,
    mode: st.mode,
    version: st.version,
    commitId: st.commitId,
  });
});

filesRoutes.get('/files/content', async (c) => {
  const q = parseQuery(c, ContentQuery);
  return streamFile(c, c.get('ws'), q.path, { at: q.at, download: isFlag(q.download) });
});

filesRoutes.get('/files/zip', async (c) => {
  const q = parseQuery(c, ZipQuery);
  const ws = c.get('ws');
  const roots = [...new Set(q.paths)];
  let zipName = q.name?.trim();
  if (!zipName) {
    if (roots.length === 1) zipName = roots[0] === '/' ? ws.name : basename(roots[0]);
    else zipName = `volumes-${new Date().toISOString().slice(0, 10)}`;
  }
  return streamZip(c, ws, roots, { at: q.at, zipName });
});

filesRoutes.post('/folders', async (c) => {
  const body = await parseJson(c, CreateFolderRequest);
  const action = await createFolder({ ws: c.get('ws'), userId: c.get('user').id }, body.path);
  return ok(c, MutationResponse, { action });
});

filesRoutes.post('/files/move', async (c) => {
  const body = await parseJson(c, MoveRequest);
  const action = await movePaths({ ws: c.get('ws'), userId: c.get('user').id }, body.items, body.overwrite ?? false);
  return ok(c, MutationResponse, { action });
});

filesRoutes.post('/files/copy', async (c) => {
  const body = await parseJson(c, CopyRequest);
  const action = await copyPaths({ ws: c.get('ws'), userId: c.get('user').id }, body.items, body.overwrite ?? false);
  return ok(c, MutationResponse, { action });
});

filesRoutes.post('/files/delete', async (c) => {
  const body = await parseJson(c, DeleteRequest);
  const action = await deletePaths({ ws: c.get('ws'), userId: c.get('user').id }, body.paths);
  return ok(c, MutationResponse, { action });
});

filesRoutes.get('/search', async (c) => {
  const q = parseQuery(c, SearchQuery);
  return ok(c, SearchResponse, await searchFiles(c.get('ws'), q.q, q.at, q.limit));
});
