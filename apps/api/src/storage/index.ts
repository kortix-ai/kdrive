import path from 'node:path';
import { env } from '../env';
import { EmulatedStore } from './emulated';
import { PlatinumStore } from './platinum';
import type { VolumeStore } from './types';

export * from './types';

let store: VolumeStore | null = null;

export class StorageConfigError extends Error {}

/**
 * Builds the configured driver: `VOLUMES_STORAGE=emulated` forces the on-disk
 * emulator; otherwise PT_API_URL + PT_TOKEN select Platinum. Anything else is
 * a configuration error (the server refuses to start).
 */
export function createStore(): VolumeStore {
  if (env.storageDriver === 'emulated') {
    return new EmulatedStore({ dir: path.resolve(env.VOLUMES_DATA_DIR) });
  }
  if (env.storageDriver === 'platinum' && env.PT_API_URL && env.PT_TOKEN) {
    return new PlatinumStore({ url: env.PT_API_URL, token: env.PT_TOKEN });
  }
  throw new StorageConfigError(
    'No storage configured. Set PT_API_URL and PT_TOKEN for Platinum, or VOLUMES_STORAGE=emulated for the local emulator.',
  );
}

export function getStore(): VolumeStore {
  if (!store) store = createStore();
  return store;
}

export function storageMode(): 'platinum' | 'emulated' {
  return getStore().driver;
}

/** Tests swap in their own store (e.g. an EmulatedStore with a fake clock). */
export function setStoreForTests(s: VolumeStore | null): void {
  store = s;
}
