import { describe, expect, test } from 'bun:test';
import { matchesChord } from './keys';

const ev = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;

describe('matchesChord', () => {
  test('plain letters and symbols', () => {
    expect(matchesChord('h', ev('h'))).toBe(true);
    expect(matchesChord('h', ev('H', { shiftKey: true }))).toBe(false);
    expect(matchesChord('?', ev('?', { shiftKey: true }))).toBe(true);
    expect(matchesChord('/', ev('/'))).toBe(true);
    expect(matchesChord('space', ev(' '))).toBe(true);
    expect(matchesChord('escape', ev('Escape'))).toBe(true);
  });
  test('mod is ⌘ on mac and Ctrl elsewhere', () => {
    expect(matchesChord('mod+z', ev('z', { metaKey: true }), true)).toBe(true);
    expect(matchesChord('mod+z', ev('z', { ctrlKey: true }), true)).toBe(false);
    expect(matchesChord('mod+z', ev('z', { ctrlKey: true }), false)).toBe(true);
    expect(matchesChord('z', ev('z', { metaKey: true }), true)).toBe(false);
  });
  test('shift chords', () => {
    expect(matchesChord('shift+u', ev('U', { shiftKey: true }))).toBe(true);
    expect(matchesChord('shift+u', ev('u'))).toBe(false);
  });
});
