import { METER_AMBER, METER_RED } from './constants';

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Binary units: 0 → "0 B", 4404019 → "4.2 MiB". Negative numbers keep their sign. */
export function formatBytes(n: number, opts: { digits?: number } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  let v = Math.abs(n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return `${sign}${Math.round(v)} B`;
  const digits = opts.digits ?? (v >= 100 ? 0 : 1);
  return `${sign}${v.toFixed(digits).replace(/\.0+$/, '')} ${UNITS[u]}`;
}

export type MeterLevel = 'ok' | 'amber' | 'red';

/** Quota meter level: amber at ≥80 %, red at ≥95 %. */
export function meterLevel(used: number, quota: number): MeterLevel {
  if (quota <= 0) return used > 0 ? 'red' : 'ok';
  const r = used / quota;
  if (r >= METER_RED) return 'red';
  if (r >= METER_AMBER) return 'amber';
  return 'ok';
}

/** `vc_01ABC…` → `@01abc..` (7 chars, no prefix). */
export function shortId(id: string | null | undefined): string {
  if (!id) return '';
  const bare = id.replace(/^[a-z]{2,4}_/i, '');
  return '@' + bare.slice(0, 7).toLowerCase();
}
