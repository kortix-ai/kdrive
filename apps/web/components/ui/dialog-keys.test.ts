import { describe, expect, test } from 'bun:test';
import { createEnterGate, createEnterTracker, enterSubmits, type EnterTarget } from './dialog-keys';

const el = (tagName: string, attrs: Record<string, string> = {}, extra: Partial<EnterTarget> = {}): EnterTarget => ({
  tagName,
  type: attrs.type,
  getAttribute: (n) => attrs[n] ?? null,
  ...extra,
});

const ok = { inDialog: true, primaryDisabled: false };

describe('dialog ↵', () => {
  test('Enter on a focused Cancel button does not submit (the button handles Enter itself)', () => {
    expect(enterSubmits(el('BUTTON', { type: 'button' }), ok)).toBe(false);
  });

  test('Enter on the primary button is left to its own click (never submits twice)', () => {
    expect(enterSubmits(el('BUTTON'), ok)).toBe(false);
  });

  test('controls that handle Enter themselves never submit', () => {
    expect(enterSubmits(el('A', { href: '/x' }), ok)).toBe(false);
    expect(enterSubmits(el('SELECT'), ok)).toBe(false);
    expect(enterSubmits(el('TEXTAREA'), ok)).toBe(false);
    expect(enterSubmits(el('SUMMARY'), ok)).toBe(false);
    for (const role of ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'switch', 'combobox', 'treeitem', 'gridcell', 'radio', 'checkbox']) {
      expect(enterSubmits(el('DIV', { role, tabindex: '0' }), ok)).toBe(false);
    }
    for (const type of ['button', 'submit', 'reset', 'image', 'file', 'color', 'range']) {
      expect(enterSubmits(el('INPUT', { type }), ok)).toBe(false);
    }
    expect(enterSubmits(el('DIV', {}, { isContentEditable: true }), ok)).toBe(false);
    // an open autocomplete picks its option on Enter
    expect(enterSubmits(el('INPUT', { type: 'text', 'aria-expanded': 'true' }), ok)).toBe(false);
  });

  test('text fields, checkboxes and the dialog itself submit (↵ keeps working for typing users)', () => {
    expect(enterSubmits(el('INPUT', { type: 'text' }), ok)).toBe(true);
    expect(enterSubmits(el('INPUT'), ok)).toBe(true);
    expect(enterSubmits(el('INPUT', { type: 'email' }), ok)).toBe(true);
    expect(enterSubmits(el('INPUT', { type: 'datetime-local' }), ok)).toBe(true);
    expect(enterSubmits(el('INPUT', { type: 'checkbox' }), ok)).toBe(true);
    expect(enterSubmits(el('DIV', { role: 'dialog', tabindex: '-1' }), ok)).toBe(true);
    expect(enterSubmits(el('BODY'), ok)).toBe(true);
    expect(enterSubmits(null, ok)).toBe(true);
  });

  test('never submits while the primary action is disabled, or from outside the dialog', () => {
    expect(enterSubmits(el('INPUT', { type: 'text' }), { inDialog: true, primaryDisabled: true })).toBe(false);
    expect(enterSubmits(el('DIV', { role: 'dialog' }), { inDialog: true, primaryDisabled: true })).toBe(false);
    expect(enterSubmits(el('INPUT', { type: 'text' }), { inDialog: false, primaryDisabled: false })).toBe(false);
  });
});

describe('dialog ↵ gate', () => {
  test('auto-repeat and IME composition never act', () => {
    const g = createEnterGate(false);
    expect(g.accepts({ key: 'Enter', repeat: true })).toBe(false);
    expect(g.accepts({ key: 'Enter', isComposing: true })).toBe(false);
    expect(g.accepts({ key: 'Enter' })).toBe(true);
  });

  test('a press already down when the dialog opened is ignored until the key comes up', () => {
    const t = createEnterTracker();
    t.keydown({ key: 'Enter' });
    const g = createEnterGate(t.isDown());
    expect(g.accepts({ key: 'Enter' })).toBe(false); // repeat without the flag
    g.keyup({ key: 'a' });
    expect(g.accepts({ key: 'Enter' })).toBe(false);
    g.keyup({ key: 'Enter' });
    expect(g.accepts({ key: 'Enter' })).toBe(true);
  });

  test('the tracker forgets a press when focus leaves the page', () => {
    const t = createEnterTracker();
    t.keydown({ key: 'Enter' });
    t.reset();
    expect(t.isDown()).toBe(false);
    t.keydown({ key: 'Enter' });
    t.keyup({ key: 'Enter' });
    expect(t.isDown()).toBe(false);
  });
});
