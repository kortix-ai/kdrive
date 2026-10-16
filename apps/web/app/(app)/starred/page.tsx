'use client';

// /starred — the items this person starred, in every drive they can open, newest star first.
// A star follows its item through renames and moves; deleted items and drives they can no
// longer open drop out. Clicking an item opens it in its drive.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, FolderOpen, SquareArrowOutUpRight, Star, StarOff } from 'lucide-react';
import type { StarredItem } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Page, PageHeader } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/tooltip';
import { CrossDriveRow, CrossHead, CrossSkeleton } from '@/components/drive/cross-drive-row';
import { When } from '@/components/versioning/readout';
import { openInDrive, setStarIn, useStarred } from '@/lib/drive/stars';
import { errorText } from '@/lib/versioning/hooks';

const keyOf = (it: StarredItem) => `${it.workspaceId}:${it.path}`;
const I = { size: 16, strokeWidth: 1.75 } as const;

export default function StarredPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useStarred();
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  const items = useMemo(() => (data?.items ?? []).filter((it) => !gone.has(keyOf(it))), [data, gone]);
  const open = (it: StarredItem) => openInDrive((href) => router.push(href), it);
  const unstar = async (it: StarredItem) => {
    const k = keyOf(it);
    setGone((s) => new Set(s).add(k));
    if (await setStarIn(it.workspaceId, it.path, false)) return;
    setGone((s) => {
      const n = new Set(s);
      n.delete(k);
      return n;
    });
  };

  const menuFor = (it: StarredItem): MenuItem[] => [
    {
      id: 'open',
      label: 'Open',
      icon: it.type === 'dir' ? <FolderOpen {...I} /> : <SquareArrowOutUpRight {...I} />,
      kbd: '↵',
      onSelect: () => open(it),
    },
    { id: 's1', type: 'separator' },
    { id: 'unstar', label: 'Remove from Starred', icon: <StarOff {...I} />, onSelect: () => void unstar(it) },
  ];

  return (
    <Page>
      <PageHeader eyebrow="Your items" title="Starred" lead="Files and folders you starred, in every drive you can open. Stars are yours alone." />

      <div className="mt-6">
        {isLoading ? (
          <CrossSkeleton />
        ) : error ? (
          <EmptyState
            title="Couldn't load starred items."
            body={errorText(error)}
            actions={
              <Button variant="tonal" onClick={() => void mutate()}>
                Retry
              </Button>
            }
          />
        ) : !items.length ? (
          <EmptyState
            art="folder"
            title="Nothing starred yet."
            body={
              <>
                Star a file or folder from its row, its menu or the preview, or select it and press <Kbd>S</Kbd>. It stays here when it moves.
              </>
            }
            actions={
              <Button variant="tonal" onClick={() => router.push('/drive')}>
                Go to files
              </Button>
            }
          />
        ) : (
          <div role="list" aria-label="Starred items">
            <div className="sticky top-0 z-[2] bg-vx-surface">
              <CrossHead when="Modified" />
            </div>
            {items.map((it) => (
              <CrossDriveRow
                key={keyOf(it)}
                item={it}
                when={<When at={it.mtime} />}
                onOpen={() => open(it)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ at: { x: e.clientX, y: e.clientY }, items: menuFor(it) });
                }}
                actions={
                  <>
                    <Tooltip label="Remove from Starred">
                      <IconButton size="sm" label={`Unstar ${it.name}`} nativeTitle={false} aria-pressed onClick={() => void unstar(it)}>
                        <Star size={16} strokeWidth={1.75} fill="currentColor" aria-hidden />
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      size="sm"
                      label={`More actions for ${it.name}`}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu({ at: { x: r.right - 240, y: r.bottom + 4 }, items: menuFor(it) });
                      }}
                    >
                      <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
                    </IconButton>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </Page>
  );
}
