import { describe, expect, test } from 'bun:test';
import { accessBadges, accessRequest, addEmails, draftFromLink, OPEN_ACCESS, parseEmails } from './access';
import { expiryToIso, linkStatus, sortLinks, toLocalInput } from './expiry';

const now = new Date('2026-09-28T10:00:00.000Z');
const DAY = 86_400_000;

describe('share expiry', () => {
  test('presets', () => {
    expect(expiryToIso('never', '', now)).toBeNull();
    expect(expiryToIso('1d', '', now)).toBe(new Date(now.getTime() + DAY).toISOString());
    expect(expiryToIso('7d', '', now)).toBe(new Date(now.getTime() + 7 * DAY).toISOString());
    expect(expiryToIso('30d', '', now)).toBe(new Date(now.getTime() + 30 * DAY).toISOString());
  });

  test('custom must be a future date', () => {
    const future = new Date(now.getTime() + 2 * DAY);
    expect(expiryToIso('custom', toLocalInput(future), now)).toBe(new Date(toLocalInput(future)).toISOString());
    expect(() => expiryToIso('custom', '', now)).toThrow('Pick a date');
    expect(() => expiryToIso('custom', 'not a date', now)).toThrow('not valid');
    expect(() => expiryToIso('custom', toLocalInput(new Date(now.getTime() - DAY)), now)).toThrow('future');
  });

  test('toLocalInput is a datetime-local value', () => {
    expect(toLocalInput(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03');
  });

  test('linkStatus', () => {
    expect(linkStatus({ revokedAt: null, expiresAt: null }, now)).toBe('active');
    expect(linkStatus({ revokedAt: null, expiresAt: new Date(now.getTime() + 1000).toISOString() }, now)).toBe('active');
    expect(linkStatus({ revokedAt: null, expiresAt: new Date(now.getTime() - 1000).toISOString() }, now)).toBe('expired');
    expect(linkStatus({ revokedAt: now.toISOString(), expiresAt: null }, now)).toBe('revoked');
  });

  test('sortLinks: active, then expired, then revoked; newest first', () => {
    const mk = (id: string, created: number, extra: { revokedAt?: string; expiresAt?: string } = {}) => ({
      id,
      createdAt: new Date(now.getTime() - created).toISOString(),
      revokedAt: extra.revokedAt ?? null,
      expiresAt: extra.expiresAt ?? null,
    });
    const out = sortLinks(
      [
        mk('revoked', 1, { revokedAt: now.toISOString() }),
        mk('old', 5000),
        mk('expired', 2, { expiresAt: new Date(now.getTime() - 1).toISOString() }),
        mk('new', 10),
      ],
      now,
    );
    expect(out.map((l) => l.id)).toEqual(['new', 'old', 'expired', 'revoked']);
  });
});

describe('link access', () => {
  test('parseEmails splits lists and keeps what is not an address', () => {
    expect(parseEmails('Ada@X.io, bo@y.io;<cy@z.io>\nnope')).toEqual({ valid: ['ada@x.io', 'bo@y.io', 'cy@z.io'], invalid: ['nope'] });
    expect(addEmails(['ada@x.io'], ['ada@x.io', 'bo@y.io'])).toEqual(['ada@x.io', 'bo@y.io']);
  });

  test('accessRequest: create, keep, change and remove a password', () => {
    expect(accessRequest(OPEN_ACCESS)).toEqual({ allowDownload: true, allowedEmails: [] });
    expect(() => accessRequest({ ...OPEN_ACCESS, passwordOn: true })).toThrow('Type a password');
    expect(() => accessRequest({ ...OPEN_ACCESS, passwordOn: true, password: 'abc' })).toThrow('at least 4');
    expect(accessRequest({ ...OPEN_ACCESS, passwordOn: true, password: 'abcd' }).password).toBe('abcd');
    // Editing a link that has one: empty keeps it, off removes it.
    expect('password' in accessRequest({ ...OPEN_ACCESS, passwordOn: true }, true)).toBe(false);
    expect(accessRequest(OPEN_ACCESS, true).password).toBeNull();
    expect(() => accessRequest({ ...OPEN_ACCESS, peopleOn: true })).toThrow('at least one email');
    expect(accessRequest({ ...OPEN_ACCESS, peopleOn: false, emails: ['a@b.io'] }).allowedEmails).toEqual([]);
  });

  test('badges and drafts follow the link', () => {
    const link = { hasPassword: true, allowDownload: false, allowedEmails: ['a@b.io', 'c@d.io'] };
    expect(accessBadges(link)).toEqual(['people', 'password', 'view-only']);
    expect(accessBadges({ hasPassword: false, allowDownload: true, allowedEmails: [] })).toEqual([]);
    expect(draftFromLink(link)).toEqual({ passwordOn: true, password: '', allowDownload: false, peopleOn: true, emails: ['a@b.io', 'c@d.io'] });
  });
});
