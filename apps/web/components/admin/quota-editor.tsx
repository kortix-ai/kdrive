'use client';

import { useState } from 'react';
import { GiB, MAX_QUOTA_BYTES, formatBytes, type AdminUser } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { api } from '@/lib/api/endpoints';

export const MAX_QUOTA_GIB = MAX_QUOTA_BYTES / GiB;
const PRESETS = ['10', '20', '50'] as const;

/** Parses a GiB amount ("12.5") into bytes; error text when empty, not a number, ≤ 0 or over the 50 GiB cap. */
export function parseGiB(input: string): { bytes: number | null; error: string | null } {
  const s = input.trim();
  if (!s) return { bytes: null, error: 'Enter a size in GiB.' };
  const n = Number(s);
  if (!Number.isFinite(n)) return { bytes: null, error: 'Enter a number.' };
  if (n <= 0) return { bytes: null, error: 'Must be more than 0 GiB.' };
  if (n > MAX_QUOTA_GIB) return { bytes: null, error: `Max ${MAX_QUOTA_GIB} GiB` };
  return { bytes: Math.round(n * GiB), error: null };
}

/** "10", "12.5": a quota in GiB for the input. */
export function toGiBInput(bytes: number): string {
  const g = bytes / GiB;
  return Number.isInteger(g) ? String(g) : g.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Inline quota editor: GiB input + 10 | 20 | 50 presets; ↵ saves, Esc cancels; over 50 GiB is refused.
 * `capBytes`: storage's size cap for ONE workspace; a quota above it is allowed but flagged.
 */
export function QuotaEditor({ user, capBytes, onDone }: { user: AdminUser; capBytes?: number; onDone: (updated?: AdminUser, warning?: string) => void }) {
  const [value, setValue] = useState(toGiBInput(user.quotaBytes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseGiB(value);
  const overCap = !!capBytes && parsed.bytes !== null && parsed.bytes > capBytes;

  const save = async () => {
    if (parsed.bytes === null || busy) return;
    if (parsed.bytes === user.quotaBytes) return onDone();
    setBusy(true);
    setError(null);
    try {
      const { user: updated, warning } = await api.admin.setQuota(user.id, parsed.bytes);
      onDone(updated, warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the quota.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_QUOTA_GIB}
          step="any"
          mono
          aria-label={`Quota for ${user.email} in GiB`}
          value={value}
          suffix="GiB"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onDone();
            }
          }}
          invalid={parsed.error && value.trim() ? parsed.error : null}
          className="w-[120px] [&_input]:[appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none"
        />
        <Segmented
          size="sm"
          label="Quota presets"
          value={PRESETS.find((p) => p === value.trim()) ?? ('' as (typeof PRESETS)[number])}
          onChange={(v) => setValue(v)}
          options={PRESETS.map((p) => ({ value: p, label: p }))}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="primary" onClick={() => void save()} loading={busy} disabled={parsed.bytes === null} kbd="↵">
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone()} disabled={busy} kbd="Esc">
          Cancel
        </Button>
      </div>
      {capBytes ? (
        <p className={overCap ? 'border-l-2 border-vx-hair-strong pl-2 text-[12px] text-vx-text-2' : 'vx-micro text-vx-text-4'}>
          Storage caps one workspace at {formatBytes(capBytes)}
          {overCap ? ': the rest of this quota is usable only across several workspaces.' : '.'}
        </p>
      ) : null}
      {error ? <p className="border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{error}</p> : null}
    </div>
  );
}

export default QuotaEditor;
