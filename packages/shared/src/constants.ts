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
