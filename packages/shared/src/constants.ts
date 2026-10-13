export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;

/** Platinum block size: every upload plan splits files into 1 MiB blocks. */
export const BLOCK_SIZE = 1_048_576;
/** Platinum per-plan limits. */
export const MAX_PLAN_FILES = 10_000;
export const MAX_PLAN_BLOCKS = 1_000_000;
/** Largest single write Platinum accepts (and the emulator enforces). */
export const MAX_WRITE_BYTES = 64 * MiB;

export const DEFAULT_QUOTA_BYTES = 10 * GiB;
export const MAX_QUOTA_BYTES = 50 * GiB;

/** Tags per volume, shared by checkpoints and pinned links. */
export const TAG_BUDGET = 100;
/** Concurrent upload plans per Platinum org. */
export const MAX_UPLOADS_IN_FLIGHT = 4;

export const UNDO_WINDOW_MS = 8000;

export const METER_AMBER = 0.8;
export const METER_RED = 0.95;

export const TEXT_PREVIEW_MAX_BYTES = 5 * MiB;
export const TEXT_DIFF_MAX_BYTES = 2 * MiB;
export const IMAGE_THUMB_MAX_BYTES = 20 * MiB;

export const MAX_NAME_BYTES = 255;
export const MAX_PATH_BYTES = 4096;

export const RETENTION_COPY = 'Every version from the last 7 days, your newest 50 always, and checkpoints forever.';

export const CHECKPOINT_TAG_PREFIX = 'cp-';
export const LINK_TAG_PREFIX = 'ln-';
export const VOLUME_NAME_PREFIX = 'vx-';

/** AI agent access (MCP). */
export const AGENT_TOKEN_PREFIX = 'vx_pat_';
export const AGENT_TOKEN_MAX_DAYS = 365;
/** Text returned by one MCP read call, across all files. */
export const MCP_TEXT_READ_MAX = 1 * MiB;
/** Decoded bytes per file in one write_changes op. */
export const MCP_WRITE_FILE_MAX = 10 * MiB;
/** Decoded bytes across one write_changes call. */
export const MCP_WRITE_BATCH_MAX = 24 * MiB;
export const MCP_BATCH_OPS_MAX = 200;
export const PROPOSAL_TTL_DAYS = 30;
/** Open proposals per user. */
export const PROPOSAL_OPEN_MAX = 50;
/** Staged bytes per user, across all open proposals. */
export const PROPOSAL_STAGED_MAX = 256 * MiB;

/** Email + password accounts: length bounds the server and the forms both enforce. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** People on one drive, the owner and open invitations included. */
export const MAX_DRIVE_PEOPLE = 50;
/** An invitation nobody answered stops working after this many days. */
export const INVITE_TTL_DAYS = 30;
