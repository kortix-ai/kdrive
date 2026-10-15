'use client';

// The drive toolbar's tag filter: a chip that lists the drive's tags. Picking one shows
// every item that carries it, across the drive; the chip then names the tag and clears it.
import { Tag, X } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { labelIndex, useActiveFilter, useAnnotationsUi, useLabels } from '@/lib/annotations';
import { useVx } from '@/lib/store';
import { LabelDot } from './label-chip';

export default function LabelFilter() {
  const ws = useVx((s) => s.workspaceId);
  const { data } = useLabels();
  const active = useActiveFilter();
  const setFilter = useAnnotationsUi((s) => s.setFilter);
  const current = active ? labelIndex(data)?.byId.get(active) : undefined;
  if (!ws || !data || (!data.labels.length && !current)) return null;

  const items: MenuItem[] = [
    { id: 'head', type: 'label', label: 'Show items tagged' },
    ...data.labels.map(
      (l): MenuItem => ({
        id: l.id,
        label: l.name,
        icon: <LabelDot color={l.color} />,
        hint: `${l.count} ${l.count === 1 ? 'item' : 'items'}`,
        checked: l.id === active,
        onSelect: () => setFilter(l.id === active ? null : { ws, labelId: l.id }),
      }),
    ),
    { id: 's1', type: 'separator' },
    ...(current ? [{ id: 'clear', label: 'Show all items', icon: <X size={16} strokeWidth={1.75} />, onSelect: () => setFilter(null) } as MenuItem] : []),
    { id: 'manage', label: 'Manage tags…', icon: <Tag size={16} strokeWidth={1.75} />, onSelect: () => useAnnotationsUi.getState().setManageOpen(true) },
  ];

  return (
    <span className="flex shrink-0 items-center max-[720px]:hidden">
      <Menu
        align="end"
        minWidth={220}
        items={items}
        trigger={(p) => (
          <span onClick={p.onClick} aria-expanded={p['aria-expanded']} aria-haspopup="menu" className="inline-flex">
            <Chip on={!!current} icon={<Tag size={14} strokeWidth={1.75} aria-hidden />} title={current ? `Showing items tagged ${current.name}` : 'Filter by tag'}>
              {current ? (
                <span className="flex max-w-[140px] items-center gap-1.5">
                  <LabelDot color={current.color} />
                  <span className="truncate">{current.name}</span>
                </span>
              ) : (
                'Tags'
              )}
            </Chip>
          </span>
        )}
      />
      {current ? (
        <Tooltip label="Clear the filter">
          <button
            type="button"
            aria-label="Clear the tag filter"
            onClick={() => setFilter(null)}
            className="ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded-vx-sm text-vx-text-3 hover:bg-vx-raise hover:text-vx-text-1"
          >
            <X size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}
