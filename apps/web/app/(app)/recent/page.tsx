'use client';

// /recent — files this person opened (previewed or downloaded) or changed (uploads, edits,
// renames and moves from the ledger), in every drive they can open, newest first, in
// Today / Yesterday / This week / Earlier bands. Files that no longer exist drop out.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Ellipsis, SquareArrowOutUpRight, Star } from 'lucide-react';
import type { RecentItem } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Page, PageHeader } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/tooltip';
import { CrossDriveRow, CrossHead, CrossSkeleton } from '@/components/drive/cross-drive-row';
import { When } from '@/components/versioning/readout';
import { triggerDownload } from '@/lib/drive/actions';
import { groupRecent } from '@/lib/drive/recent-groups';
import { openInDrive, recordOpen, setStarIn, useRecent } from '@/lib/drive/stars';
import { contentUrl } from '@/lib/urls';
import { useVx } from '@/lib/store';
import { errorText } from '@/lib/versioning/hooks';

const keyOf = (it: RecentItem) => `${it.workspaceId}:${it.path}`;
const I = { size: 16, strokeWidth: 1.75 } as const;

function download(it: RecentItem) {
  triggerDownload(contentUrl(it.workspaceId, it.path, { download: true }));
  recordOpen(it.workspaceId, it.path);
}

export default function RecentPage() {
  const router = useRouter();
  const toast = useVx((s) => s.toast);
  const { data, error, isLoading, mutate } = useRecent();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  const groups = useMemo(() => groupRecent(data?.items ?? []), [data]);
  const open = (it: RecentItem) => openInDrive((href) => router.push(href), { ...it, type: 'file' });
  const star = async (it: RecentItem) => {
    if (await setStarIn(it.workspaceId, it.path, true)) toast({ kind: 'success', message: `Starred ${it.name}` });
  };

  const menuFor = (it: RecentItem): MenuItem[] => [
    { id: 'open', label: 'Open', icon: <SquareArrowOutUpRight {...I} />, kbd: '↵', onSelect: () => open(it) },
    { id: 'dl', label: 'Download', icon: <Download {...I} />, onSelect: () => download(it) },
    { id: 's1', type: 'separator' },
    { id: 'star', label: 'Add to Starred', icon: <Star {...I} />, onSelect: () => void star(it) },
  ];

  return (
    <Page>
      <PageHeader eyebrow="Your activity" title="Recent" lead="Files you opened or changed lately, in every drive you can open." />

      <div className="mt-6">
        {isLoading ? (
          <CrossSkeleton />
        ) : error ? (
          <EmptyState
            title="Couldn't load recent files."
            body={errorText(error)}
            actions={
              <Button variant="tonal" onClick={() => void mutate()}>
                Retry
              </Button>
            }
          />
        ) : !groups.length ? (
          <EmptyState
            art="history"
            title="Nothing recent yet."
            body="Files you open, upload or edit show up here, newest first."
            actions={
              <Button variant="tonal" onClick={() => router.push('/drive')}>
                Go to files
              </Button>
            }
          />
        ) : (
          <div role="list" aria-label="Recent files">
            <div className="sticky top-0 z-[2] bg-vx-surface">
              <CrossHead when="When" />
            </div>
            {groups.map((g) => (
              <section key={g.band} aria-label={g.label}>
                <div className="vx-eyebrow border-b border-vx-hair-soft px-3 pb-1.5 pt-5">{g.label}</div>
                {g.items.map((it) => (
                  <CrossDriveRow
                    key={keyOf(it)}
                    item={{ ...it, type: 'file' }}
                    hint={it.reason === 'edited' ? 'Edited by you' : 'Opened'}
                    when={<When at={it.at} friendly />}
                    onOpen={() => open(it)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ at: { x: e.clientX, y: e.clientY }, items: menuFor(it) });
                    }}
                    actions={
                      <>
                        <Tooltip label="Download">
                          <IconButton size="sm" label={`Download ${it.name}`} nativeTitle={false} onClick={() => download(it)}>
                            <Download size={16} strokeWidth={1.75} aria-hidden />
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
              </section>
            ))}
          </div>
        )}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </Page>
  );
}
