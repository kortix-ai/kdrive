// The current folder's ▾ menu offers Rename drive… only at the drive's top level.
import { describe, expect, test } from 'bun:test';
import { buildFolderMenu } from './context-menu';

const noop = () => {};
const base = { past: false, cmd: { newFolder: noop, uploadFiles: noop, uploadFolder: noop }, share: noop, history: noop, downloadZip: noop };

describe('buildFolderMenu', () => {
  test('ends with Rename drive… when given renameDrive', () => {
    let opened = 0;
    const items = buildFolderMenu({ ...base, renameDrive: () => opened++ });
    const last = items[items.length - 1];
    expect(last.id).toBe('rename-drive');
    expect(items[items.length - 2].type).toBe('separator');
    (last as { onSelect: () => void }).onSelect();
    expect(opened).toBe(1);
  });

  test('has no Rename drive… inside a folder', () => {
    const items = buildFolderMenu(base);
    expect(items.some((i) => i.id === 'rename-drive')).toBe(false);
    expect(items[items.length - 1].id).toBe('zip');
  });
});
