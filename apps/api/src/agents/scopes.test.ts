import { describe, expect, test } from 'bun:test';
import { MODE_COPY as SHARED_MODE, SCOPE_COPY as SHARED_SCOPE } from '@volumes/shared';
import { MODE_COPY, SCOPE_COPY, effectiveMode, highestScope, scopeAllows, scopeLevel, scopesUpTo } from './scopes';

describe('agent scopes', () => {
  test('levels are ordered read < propose < write', () => {
    expect(scopeLevel('drive:read')).toBe(0);
    expect(scopeLevel('drive:propose')).toBe(1);
    expect(scopeLevel('drive:write')).toBe(2);
    expect(scopeAllows('drive:write', 'drive:read')).toBe(true);
    expect(scopeAllows('drive:propose', 'drive:write')).toBe(false);
    expect(scopeAllows('drive:read', 'drive:read')).toBe(true);
  });

  test('highestScope picks the strongest drive scope and ignores the rest', () => {
    expect(highestScope('openid offline_access drive:read drive:write')).toBe('drive:write');
    expect(highestScope('drive:propose  drive:read')).toBe('drive:propose');
    expect(highestScope('openid profile email')).toBeNull();
    expect(highestScope('')).toBeNull();
    expect(highestScope('drive:admin drive:readx')).toBeNull();
  });

  test('scopesUpTo lists every implied scope', () => {
    expect(scopesUpTo('drive:read')).toEqual(['drive:read']);
    expect(scopesUpTo('drive:propose')).toEqual(['drive:read', 'drive:propose']);
    expect(scopesUpTo('drive:write')).toEqual(['drive:read', 'drive:propose', 'drive:write']);
  });

  test('only drive:write keeps direct mode', () => {
    expect(effectiveMode('drive:write', 'direct')).toBe('direct');
    expect(effectiveMode('drive:write', 'review')).toBe('review');
    expect(effectiveMode('drive:propose', 'direct')).toBe('review');
    expect(effectiveMode('drive:read', 'direct')).toBe('review');
  });

  test('the web copy matches the API copy word for word', () => {
    expect(SHARED_SCOPE).toEqual(SCOPE_COPY);
    expect(SHARED_MODE).toEqual(MODE_COPY);
  });
});
