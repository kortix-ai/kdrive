import { MAX_UPLOADS_IN_FLIGHT } from '@volumes/shared';
import { VolumeStoreError } from './types';

/**
 * Process-wide semaphore of Platinum upload slots (4 per org, shared by all
 * users). acquire() waits FIFO; on timeout it throws rate_limited so the
 * browser retries. A slot is released on commit/abort/failure, or 15 minutes
 * after its last touch (every block PUT touches).
 */
export class UploadSlots {
  private held = new Map<string, number>(); // uploadId -> last touch (ms)
  private waiters: { id: string; resolve: () => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(
    readonly capacity = MAX_UPLOADS_IN_FLIGHT,
    readonly idleMs = 15 * 60_000,
    private now: () => number = Date.now,
  ) {}

  get inUse(): number {
    this.sweep();
    return this.held.size;
  }

  has(uploadId: string): boolean {
    return this.held.has(uploadId);
  }

  async acquire(uploadId: string, opts: { waitMs?: number } = {}): Promise<void> {
    this.sweep();
    if (this.held.has(uploadId)) {
      this.touch(uploadId);
      return;
    }
    if (this.held.size < this.capacity && this.waiters.length === 0) {
      this.held.set(uploadId, this.now());
      return;
    }
    const waitMs = opts.waitMs ?? 30_000;
    await new Promise<void>((resolve, reject) => {
      const entry = {
        id: uploadId,
        resolve: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        reject,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(entry);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(
            new VolumeStoreError(429, 'rate_limited', 'All upload slots are busy; retry shortly.', {
              retryAfterSeconds: 5,
              retryable: true,
            }),
          );
        }, waitMs),
      };
      this.waiters.push(entry);
    });
  }

  /**
   * Re-keys a slot acquired under a temporary id (drivers acquire before
   * Platinum mints the upload id).
   */
  rename(from: string, to: string): void {
    const t = this.held.get(from);
    if (t === undefined) return;
    this.held.delete(from);
    this.held.set(to, t);
  }

  touch(uploadId: string): void {
    if (this.held.has(uploadId)) this.held.set(uploadId, this.now());
  }

  release(uploadId: string): void {
    if (!this.held.delete(uploadId)) return;
    this.pump();
  }

  private sweep(): void {
    const cutoff = this.now() - this.idleMs;
    let freed = false;
    for (const [id, t] of this.held) {
      if (t < cutoff) {
        this.held.delete(id);
        freed = true;
      }
    }
    if (freed) this.pump();
  }

  private pump(): void {
    while (this.held.size < this.capacity && this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      // Hand the slot over synchronously so a concurrent acquire can't steal it.
      this.held.set(next.id, this.now());
      next.resolve();
    }
  }
}

/** The process-wide instance both drivers share. */
export const uploadSlots = new UploadSlots();
