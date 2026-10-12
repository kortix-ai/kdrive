import { describe, expect, test } from 'bun:test';
import { changeEmailNotice, VERIFY_BEFORE_CHANGE } from './account-email';
import { passwordChangedNotice } from './account-password';
import { SESSIONS_REVOKED_NOTICE, sessionsCopy } from './account-section';

describe('account settings copy', () => {
  test('an email change is always two steps, and an unverified address must be verified first', () => {
    expect(changeEmailNotice('a@x.test', 'b@x.test')).toMatch(/a@x\.test.*b@x\.test/);
    expect(VERIFY_BEFORE_CHANGE).toMatch(/Verify this address/);
  });
  test('signing out everywhere says what happens to agent access', () => {
    expect(passwordChangedNotice(true)).toMatch(/agent tokens and connected apps were disconnected/);
    expect(passwordChangedNotice(false)).toBe('Password changed.');
    expect(SESSIONS_REVOKED_NOTICE).toMatch(/Agent tokens and connected apps keep working/);
  });
  test('sessions count reads naturally', () => {
    expect(sessionsCopy(1)).toBe('Signed in on this device only.');
    expect(sessionsCopy(2)).toBe('Signed in here and on 1 other session.');
    expect(sessionsCopy(4)).toBe('Signed in here and on 3 other sessions.');
  });
});
