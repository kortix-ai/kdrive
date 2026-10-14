import type { DriveRole } from '@volumes/shared';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /** Set for cookie sessions (agent principals leave it out). */
  emailVerified?: boolean;
}

export interface SessionInfo {
  id: string;
  expiresAt: Date;
}

/** The workspace a request operates on, always resolved from the session user. */
export interface WorkspaceCtx {
  id: string;
  /** The owner: whose quota the drive's bytes count against (not necessarily the session user). */
  userId: string;
  /** The session user's role here: the owner, or a member invited as editor or viewer. */
  role: DriveRole;
  name: string;
  /** Platinum `vol_…` id (never accepted from the client). */
  volumeId: string;
  volumeName: string;
  isDefault: boolean;
}

export type AppEnv = {
  /** Set by the server (lib/node-serve.ts); absent when the app is called in-process (tests, seed). */
  Bindings: { ip?: string | null };
  Variables: {
    user: SessionUser;
    session: SessionInfo;
    ws: WorkspaceCtx;
    reqId: string;
  };
};
