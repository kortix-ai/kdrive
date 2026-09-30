import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { generateAgentToken, hashAgentToken, looksLikeAgentToken } from './tokens';

describe('agent tokens', () => {
  test('format: vx_pat_ + 43 base64url chars, 12-char prefix, sha256 hex hash', () => {
    const t = generateAgentToken();
    expect(t.secret).toMatch(/^vx_pat_[A-Za-z0-9_-]{43}$/);
    expect(t.secret.length).toBe(50);
    expect(t.prefix).toBe(t.secret.slice(0, 12));
    expect(t.hash).toBe(createHash('sha256').update(t.secret).digest('hex'));
    expect(hashAgentToken(t.secret)).toBe(t.hash);
    expect(looksLikeAgentToken(t.secret)).toBe(true);
  });

  test('every token is different', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateAgentToken().secret));
    expect(seen.size).toBe(50);
  });

  test('looksLikeAgentToken rejects anything else', () => {
    const t = generateAgentToken().secret;
    expect(looksLikeAgentToken(t + 'a')).toBe(false);
    expect(looksLikeAgentToken(t.slice(0, -1))).toBe(false);
    expect(looksLikeAgentToken(t.replace('vx_pat_', 'vx_oat_'))).toBe(false);
    expect(looksLikeAgentToken(t.slice(0, -1) + '!')).toBe(false);
    expect(looksLikeAgentToken('a.b.c')).toBe(false);
    expect(looksLikeAgentToken('')).toBe(false);
  });
});
