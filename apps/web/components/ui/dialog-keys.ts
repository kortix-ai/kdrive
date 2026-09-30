// Keyboard rules for <Dialog>. Pure functions (no React, no DOM globals) so they can be tested.

/** The parts of a focused element the ↵ rule looks at (an HTMLElement satisfies it). */
export interface EnterTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
}

export interface EnterContext {
  /** The target is inside the dialog. */
  inDialog: boolean;
  /** The dialog's primary (last footer) button is disabled or busy. */
  primaryDisabled: boolean;
}

/** Elements whose own Enter behaviour (activate, follow, open, pick) must win over the dialog's. */
const OWN_ENTER_TAGS = new Set(['BUTTON', 'A', 'SELECT', 'TEXTAREA', 'SUMMARY', 'AUDIO', 'VIDEO', 'IFRAME']);
const OWN_ENTER_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'switch',
  'combobox',
  'listbox',
  'treeitem',
  'gridcell',
  'radio',
  'checkbox',
  'slider',
  'spinbutton',
]);
const BUTTONISH_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'file', 'color', 'range']);

/**
 * Whether ↵ on `target` should run the dialog's onSubmit. Only from a single-line field,
 * a checkbox, or the dialog itself (nothing specific focused): a focused Cancel, link,
 * menu item, list option or the primary button keeps its own Enter (the primary's own
 * click runs the action once). Never while the primary action is disabled.
 */
export function enterSubmits(target: EnterTarget | null, ctx: EnterContext): boolean {
  if (!ctx.inDialog || ctx.primaryDisabled) return false;
  if (!target) return true;
  const tag = target.tagName.toUpperCase();
  if (OWN_ENTER_TAGS.has(tag)) return false;
  if (target.isContentEditable) return false;
  const role = (target.getAttribute('role') ?? '').trim().toLowerCase();
  if (role && OWN_ENTER_ROLES.has(role)) return false;
  if (target.getAttribute('aria-expanded') === 'true') return false;
  if (tag === 'INPUT') {
    const type = (target.type ?? target.getAttribute('type') ?? 'text').toLowerCase();
    if (BUTTONISH_INPUTS.has(type)) return false;
  }
  return true;
}

/** First field a dialog focuses on open: a text-entry field. Otherwise the dialog itself takes focus. */
export const INITIAL_FOCUS_SELECTOR = [
  '[autofocus]',
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=file]):not([type=color]):not([type=range]):not([disabled])',
  'textarea:not([disabled])',
].join(',');

/** The parts of a key event the ↵ gate looks at (a KeyboardEvent satisfies it). */
export interface GateKey {
  key: string;
  repeat?: boolean;
  isComposing?: boolean;
}

/**
 * Whether ↵ is physically down, page-wide. A dialog opened by an Enter press (or while
 * Enter is held) must not treat that same press as a choice: its auto-repeats, and repeats
 * that arrive without the `repeat` flag (remote desktops, some IMEs), are ignored until the
 * key comes up. Only a fresh press made while the dialog is open acts.
 */
export function createEnterTracker() {
  let down = false;
  return {
    keydown(e: GateKey) {
      if (e.key === 'Enter') down = true;
    },
    keyup(e: GateKey) {
      if (e.key === 'Enter') down = false;
    },
    /** Focus left the page (the keyup may never arrive). */
    reset() {
      down = false;
    },
    isDown: () => down,
  };
}

/**
 * Per open dialog: remembers whether ↵ was already down when it opened.
 * `accepts(e)` is true only for a fresh ↵ press that began while the dialog was open.
 */
export function createEnterGate(heldAtOpen: boolean) {
  let stale = heldAtOpen;
  return {
    keyup(e: GateKey) {
      if (e.key === 'Enter') stale = false;
    },
    accepts(e: GateKey): boolean {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return false;
      return !stale;
    },
  };
}
