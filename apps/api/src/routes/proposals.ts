// Proposals inbox and review, mounted at /api/w/:ws (requireWorkspace applies).
// (Builder B fills the handlers.)
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const proposalsRoutes = new Hono<AppEnv>();

/** GET /proposals ProposalListQuery → ProposalListResponse */
proposalsRoutes.get('/proposals', stub);
/** GET /proposals/count → ProposalCountResponse */
proposalsRoutes.get('/proposals/count', stub);
/** GET /proposals/:id → ProposalDetailResponse */
proposalsRoutes.get('/proposals/:id', stub);
/** GET /proposals/:id/files/:seq/content → the staged bytes of a write op */
proposalsRoutes.get('/proposals/:id/files/:seq/content', stub);
/** POST /proposals/:id/accept AcceptProposalRequest → AcceptProposalResponse */
proposalsRoutes.post('/proposals/:id/accept', stub);
/** POST /proposals/:id/discard DiscardProposalRequest → DiscardProposalResponse */
proposalsRoutes.post('/proposals/:id/discard', stub);
