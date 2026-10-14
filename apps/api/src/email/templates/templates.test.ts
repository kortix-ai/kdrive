import { describe, expect, test } from 'bun:test';
import { renderChangeEmailConfirm } from './change-email';
import { lifetime } from './layout';
import { renderPasswordChanged } from './password-changed';
import { renderResetPassword } from './reset';
import { renderVerifyEmail } from './verify';
import { planById } from '@volumes/shared';
import { renderStorageGranted } from './storage-granted';
import { renderStorageRequest } from './storage-request';
import { renderAccountExists, renderWelcome } from './welcome';

const URL_ = 'https://drive.example.com/api/auth/verify-email?token=abc&callbackURL=x';
const EVIL = '<script>alert(1)</script>@x.test';

const all = () => [
  renderVerifyEmail({ url: URL_, email: EVIL, expiresInSeconds: 86400 }),
  renderVerifyEmail({ url: URL_, email: EVIL, expiresInSeconds: 86400, change: true }),
  renderChangeEmailConfirm({ url: URL_, email: EVIL, newEmail: EVIL, expiresInSeconds: 86400 }),
  renderResetPassword({ url: URL_, email: EVIL, expiresInSeconds: 3600 }),
  renderPasswordChanged({ email: EVIL, resetUrl: URL_, via: 'change', when: new Date(0) }),
  renderWelcome({ email: EVIL, name: '<b>Ada</b>', appUrl: 'https://drive.example.com/drive' }),
  renderAccountExists({ email: EVIL, signInUrl: URL_, resetUrl: URL_ }),
  renderStorageRequest({ email: EVIL, requester: { email: EVIL, name: '<b>Ada</b>' }, plan: planById('plus'), note: EVIL, quotaBytes: 1, url: URL_ }),
  renderStorageGranted({ email: EVIL, plan: planById('pro'), quotaBytes: 1, url: URL_ }),
];

describe('account email templates', () => {
  test('every template has a KDRIVE subject, an HTML and a text version', () => {
    for (const r of all()) {
      expect(r.subject).toContain('KDRIVE');
      expect(r.html).toStartWith('<!DOCTYPE html>');
      expect(r.html).toContain('KDRIVE');
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.text).not.toMatch(/<(p|span|a|table)\b/);
    }
  });

  test('caller values are escaped in HTML', () => {
    for (const r of all()) {
      expect(r.html).not.toContain('<script>');
      expect(r.html).not.toContain('<b>Ada');
    }
    expect(all()[0]!.html).toContain('&lt;script&gt;');
    expect(all()[0]!.html).toContain('token=abc&amp;callbackURL=x');
  });

  test('links appear verbatim in the text version', () => {
    expect(all()[0]!.text).toContain(URL_);
    expect(all()[3]!.text).toContain(URL_);
  });

  test('lifetimes read as durations', () => {
    expect(lifetime(86400)).toBe('24 hours');
    expect(lifetime(3600)).toBe('1 hour');
    expect(lifetime(1800)).toBe('30 minutes');
  });
});
