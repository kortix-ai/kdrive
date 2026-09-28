'use client';

// STUB (FOUNDATION, placeholder). Owner: WEB-preview-share-settings. Replace freely; keep the default export and no props.
import { ChevronDown } from 'lucide-react';
import { useVx } from '@/lib/store';

export default function WorkspaceSwitcher() {
  const me = useVx((s) => s.me);
  const wsId = useVx((s) => s.workspaceId);
  const ws = me?.workspaces.find((w) => w.id === wsId);
  return (
    <div className="px-3 pb-2">
      <button
        type="button"
        title="Workspace switcher (WEB-preview-share-settings)"
        className="flex h-8 w-full items-center gap-2 border border-vx-hair px-2.5 text-left font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong"
      >
        <ChevronDown size={14} className="text-vx-text-4" />
        <span className="flex-1 truncate">{ws?.name ?? '…'}</span>
        {me && me.workspaces.length > 1 ? <span className="vx-meta text-vx-text-4">{me.workspaces.length}</span> : null}
      </button>
    </div>
  );
}
