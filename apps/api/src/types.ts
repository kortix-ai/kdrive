export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface SessionInfo {
  id: string;
  expiresAt: Date;
}

/** The workspace a request operates on, always resolved from the session user. */
export interface WorkspaceCtx {
  id: string;
  userId: string;
  name: string;
  /** Platinum `vol_…` id (never accepted from the client). */
  volumeId: string;
  volumeName: string;
  isDefault: boolean;
}

export type AppEnv = {
  Variables: {
    user: SessionUser;
    session: SessionInfo;
    ws: WorkspaceCtx;
    reqId: string;
  };
};
