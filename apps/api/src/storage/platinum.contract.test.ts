import { describe, test } from 'bun:test';
import { ulid } from 'ulid';
import { PlatinumStore } from './platinum';
import { storeContract } from './contract';
import { UploadSlots } from './upload-slots';

// Runs the same contract against real Platinum only when explicitly enabled:
//   PT_API_URL=… PT_TOKEN=… VOLUMES_CONFORMANCE=1 bun test src/storage/platinum.contract.test.ts
// It creates temporary volumes named vx-test-<ulid>-N and deletes them afterwards.
const url = process.env.PT_API_URL;
const token = process.env.PT_TOKEN;
const enabled = !!url && !!token && process.env.VOLUMES_CONFORMANCE === '1';

if (enabled) {
  storeContract('platinum', async () => ({
    store: new PlatinumStore({ url: url!, token: token!, slots: new UploadSlots() }),
    prefix: `vx-test-${ulid().toLowerCase()}`,
  }));
} else {
  describe('VolumeStore contract: platinum', () => {
    test.skip('set PT_API_URL, PT_TOKEN and VOLUMES_CONFORMANCE=1 to run against Platinum', () => {});
  });
}
