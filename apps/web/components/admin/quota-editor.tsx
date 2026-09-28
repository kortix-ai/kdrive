'use client';

import { useState } from 'react';
import { GiB, MAX_QUOTA_BYTES, formatBytes, type AdminUser } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import { api } from '@/lib/api/endpoints';

export const MAX_QUOTA_GIB = MAX_QUOTA_BYTES / GiB;
const PRESETS = ['10', '20', '50'] as const;

/** Parses a GiB amount ("12.5") into bytes; error text when empty, not a number, ≤ 0 or over the 50 GiB cap. */
export function parseGiB(input: string): { bytes: number | null; error: string | null } {
  const s = input.trim();
  if (!s) return { bytes: null, error: 'Enter a size in GB.' };
  const n = Number(s);
  if (!Number.isFinite(n)) return { bytes: null, error: 'Enter a number.' };
  if (n <= 0) return { bytes: null, error: 'Must be more than 0 GB.' };
  if (n > MAX_QUOTA_GIB) return { bytes: null, error: `Max ${MAX_QUOTA_GIB} GB` };
  return { bytes: Math.round(n * GiB), error: null };
}

/** "10", "12.5": a quota in GiB for the input. */
export function toGiBInput(bytes: number): string {
  const g = bytes / GiB;
  return Number.isInteger(g) ? String(g) : g.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Inline quota editor: a GiB field + 10 · 20 · 50 preset chips; ↵ saves, Esc cancels; over 50 GiB is refused.
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

  const preset = PRESETS.find((p) => p === value.trim());
  return (
    <div className="my-1 flex w-[280px] flex-col items-stretch gap-2 rounded-vx-md bg-vx-surface-2 p-3 text-left" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-2">
        <Input
          autoFocus
          size="sm"
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_QUOTA_GIB}
          step="any"
          aria-label={`Quota for ${user.email} in GB`}
          value={value}
          suffix="GB"
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
          className="min-w-0 flex-1 [&_input]:[appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
      <div className="flex items-center gap-1.5" role="group" aria-label="Quota presets">
        {PRESETS.map((p) => (
          <Chip key={p} size="sm" on={preset === p} onClick={() => setValue(p)}>
            {p} GB
          </Chip>
        ))}
      </div>
      {capBytes ? (
        <p className={overCap ? 'vx-meta rounded-vx-sm bg-vx-surface px-2 py-1.5 text-vx-text-2' : 'vx-meta text-vx-text-3'}>
          Storage caps one workspace at {formatBytes(capBytes)}
          {overCap ? ': the rest of this quota is usable only across several workspaces.' : '.'}
        </p>
      ) : null}
      {error ? <p role="alert" className="rounded-vx-sm bg-vx-danger-wash px-2 py-1.5 text-[13px] leading-5 text-vx-del-fg">{error}</p> : null}
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="text" onClick={() => onDone()} disabled={busy} kbd="Esc">
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()} loading={busy} disabled={parsed.bytes === null} kbd="↵">
          Save
        </Button>
      </div>
    </div>
  );
}

export default QuotaEditor;
