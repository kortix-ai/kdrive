import type { ShareLink } from '@volumes/shared';

export type ExpiryChoice = 'never' | '1d' | '7d' | '30d' | 'custom';

const DAY = 24 * 60 * 60 * 1000;

/** `datetime-local` value ("2026-09-30T18:00") for a date, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The `expiresAt` to send for a choice: ISO string, or null for "never".
 * Throws an Error with user-facing text when a custom value is missing, invalid or not in the future.
 */
export function expiryToIso(choice: ExpiryChoice, custom: string, now: Date = new Date()): string | null {
  switch (choice) {
    case 'never':
      return null;
    case '1d':
      return new Date(now.getTime() + DAY).toISOString();
    case '7d':
      return new Date(now.getTime() + 7 * DAY).toISOString();
    case '30d':
      return new Date(now.getTime() + 30 * DAY).toISOString();
    case 'custom': {
      if (!custom) throw new Error('Pick a date and time for the link to expire.');
      const d = new Date(custom);
      if (Number.isNaN(d.getTime())) throw new Error('That date is not valid.');
      if (d.getTime() <= now.getTime() + 60_000) throw new Error('The expiry must be in the future.');
      return d.toISOString();
    }
  }
}

export type LinkStatus = 'active' | 'expired' | 'revoked';

export function linkStatus(link: Pick<ShareLink, 'revokedAt' | 'expiresAt'>, now: Date = new Date()): LinkStatus {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

const rank: Record<LinkStatus, number> = { active: 0, expired: 1, revoked: 2 };

/** Active links first, then expired, then revoked; newest first within each group. */
export function sortLinks<T extends Pick<ShareLink, 'revokedAt' | 'expiresAt' | 'createdAt'>>(links: T[], now: Date = new Date()): T[] {
  return [...links].sort((a, b) => {
    const r = rank[linkStatus(a, now)] - rank[linkStatus(b, now)];
    if (r !== 0) return r;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
