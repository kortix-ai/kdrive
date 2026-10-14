// The current folder's ▾ menu offers Rename drive… only at the drive's top level; a viewer's menus
// keep write items visible but disabled.
import { describe, expect, test } from 'bun:test';
import { VIEW_ONLY_REASON } from '@/lib/store';
import { buildDriveMenu, buildFolderMenu } from './context-menu';

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

describe('view only', () => {
  const file = { path: '/a.txt', name: 'a.txt', type: 'file' as const, size: 1, mtime: 0 };
  const cmd = new Proxy({}, { get: () => noop }) as unknown as Parameters<typeof buildDriveMenu>[0]['cmd'];

  test('a viewer sees write items disabled with the reason; reads stay enabled', () => {
    const items = buildDriveMenu({ targets: [file], past: false, drift: null, cmd, viewOnly: true });
    const byId = new Map(items.map((i) => [i.id, i as { disabled?: boolean; reason?: string }]));
    for (const id of ['rename', 'mv', 'cp', 'share', 'cpt', 'del']) {
      expect(byId.get(id)?.disabled).toBe(true);
      expect(byId.get(id)?.reason).toBe(VIEW_ONLY_REASON);
    }
    for (const id of ['open', 'preview', 'dl', 'versions']) expect(byId.get(id)?.disabled).toBeFalsy();
  });

  test('an editor or owner gets the menu unchanged', () => {
    const items = buildDriveMenu({ targets: [file], past: false, drift: null, cmd });
    expect(items.some((i) => (i as { disabled?: boolean }).disabled)).toBe(false);
  });

  test('the drive menu offers Share drive… to the owner and People… to members', () => {
    const own = buildFolderMenu({ ...base, people: { open: noop, owner: true } });
    expect(own.find((i) => i.id === 'people')).toMatchObject({ label: 'Share drive…' });
    const member = buildFolderMenu({ ...base, people: { open: noop, owner: false }, viewOnly: true });
    expect(member.find((i) => i.id === 'people')).toMatchObject({ label: 'People…' });
    expect(member.find((i) => i.id === 'nf')).toMatchObject({ disabled: true });
  });
});
