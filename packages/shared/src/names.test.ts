import { describe, expect, test } from 'bun:test';
import { isValidName, validateName } from './names';

describe('validateName', () => {
  test('accepts ordinary names', () => {
    for (const n of ['a', 'report.pdf', '.bashrc', 'My Folder', 'naïve café', '日本語.txt', 'a..b']) {
      expect(validateName(n)).toBeNull();
    }
  });
  test('rejects bad names', () => {
    for (const n of ['', ' ', '.', '..', 'a/b', 'Q1\\report.txt', 'a\u0000', 'tab\there', 'x\u007f']) {
      expect(validateName(n)).not.toBeNull();
    }
    expect(isValidName('ok')).toBe(true);
    expect(validateName('Q1\\report.txt')).toBe('Name cannot contain "\\".');
  });
  test('255 byte limit counts UTF-8 bytes', () => {
    expect(validateName('x'.repeat(255))).toBeNull();
    expect(validateName('x'.repeat(256))).not.toBeNull();
    expect(validateName('é'.repeat(128))).not.toBeNull(); // 256 bytes
  });
});
