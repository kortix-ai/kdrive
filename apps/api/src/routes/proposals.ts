// Proposals inbox and review, mounted at /api/w/:ws (requireWorkspace applies).
// Only the workspace owner (the session user) reads and decides proposals.
import { Hono } from 'hono';
import {
  AcceptProposalRequest,
  AcceptProposalResponse,
  basename,
  DiscardProposalRequest,
  DiscardProposalResponse,
  IdSchema,
  isActiveContent,
  mimeFor,
  ProposalContentQuery,
  ProposalCountResponse,
  ProposalDetailResponse,
  ProposalListQuery,
  ProposalListResponse,
} from '@volumes/shared';
import { z } from 'zod';
import { ApiError, ok, parseJson, parseQuery } from '../lib/http';
import { clientIp } from '../middleware/rate-limit';
import { CONTENT_CSP, CONTENT_CSP_PDF, contentDisposition } from '../services/content';
import {
  acceptProposal,
  discardProposal,
  getProposalDetail,
  listProposals,
  loadProposal,
  proposalCount,
  proposalFilesOf,
  proposedBytes,
} from '../services/proposals';
import type { AppEnv } from '../types';

export const proposalsRoutes = new Hono<AppEnv>();

const Seq = z.coerce.number().int().min(0).max(100_000);

/** GET /proposals ProposalListQuery → ProposalListResponse */
proposalsRoutes.get('/proposals', async (c) => {
  const q = parseQuery(c, ProposalListQuery);
  const r = await listProposals(c.get('ws'), c.get('user').id, { status: q.status, limit: q.limit, before: q.before });
  return ok(c, ProposalListResponse, r);
});

/** GET /proposals/count → ProposalCountResponse */
proposalsRoutes.get('/proposals/count', async (c) => {
  return ok(c, ProposalCountResponse, { open: await proposalCount(c.get('ws'), c.get('user').id) });
});

/** GET /proposals/:id → ProposalDetailResponse */
proposalsRoutes.get('/proposals/:id', async (c) => {
  const id = IdSchema.parse(c.req.param('id'));
  return ok(c, ProposalDetailResponse, await getProposalDetail(c.get('ws'), c.get('user').id, id));
});

/** GET /proposals/:id/files/:seq/content → the staged bytes of a write op */
proposalsRoutes.get('/proposals/:id/files/:seq/content', async (c) => {
  const id = IdSchema.parse(c.req.param('id'));
  const seq = Seq.parse(c.req.param('seq'));
  const q = parseQuery(c, ProposalContentQuery);
  const ws = c.get('ws');
  const userId = c.get('user').id;
  await loadProposal(ws, userId, id);
  const f = (await proposalFilesOf(id)).find((x) => x.seq === seq);
  if (!f || f.op !== 'write') throw new ApiError(404, 'not_found', 'No proposed content there.');
  const bytes = await proposedBytes(userId, f);
  const name = basename(f.path) || 'download';
  const active = isActiveContent(name);
  const download = q.download === '1';
  const mime = mimeFor(name);
  const h = new Headers();
  // Same rules as file content: active content is never rendered on the app origin.
  h.set('Content-Type', active && !download ? 'text/plain; charset=utf-8' : mime);
  h.set('Content-Disposition', contentDisposition(download || active ? 'attachment' : 'inline', name));
  h.set('Content-Security-Policy', mime === 'application/pdf' && !active ? CONTENT_CSP_PDF : CONTENT_CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('Cache-Control', 'private, no-store');
  h.set('Content-Length', String(bytes.length));
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers: h });
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: h });
});

/** POST /proposals/:id/accept AcceptProposalRequest → AcceptProposalResponse */
proposalsRoutes.post('/proposals/:id/accept', async (c) => {
  const id = IdSchema.parse(c.req.param('id'));
  const body = await parseJson(c, AcceptProposalRequest);
  const user = c.get('user');
  const r = await acceptProposal({ ws: c.get('ws'), userId: user.id, email: user.email, ip: clientIp(c) }, id, {
    seqs: body.seqs,
    force: body.force,
  });
  return ok(c, AcceptProposalResponse, r);
});

/** POST /proposals/:id/discard DiscardProposalRequest → DiscardProposalResponse */
proposalsRoutes.post('/proposals/:id/discard', async (c) => {
  const id = IdSchema.parse(c.req.param('id'));
  const body = await parseJson(c, DiscardProposalRequest);
  const user = c.get('user');
  const r = await discardProposal({ ws: c.get('ws'), userId: user.id, email: user.email, ip: clientIp(c) }, id, { seqs: body.seqs });
  return ok(c, DiscardProposalResponse, r);
});
