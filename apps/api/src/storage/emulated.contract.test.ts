import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EmulatedStore } from './emulated';
import { storeContract } from './contract';
import { UploadSlots } from './upload-slots';

storeContract('emulated', async () => ({
  store: new EmulatedStore({ dir: mkdtempSync(path.join(tmpdir(), 'vx-contract-')), slots: new UploadSlots() }),
  prefix: 'vx-test',
}));
