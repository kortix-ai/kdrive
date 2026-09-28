// Selection model helpers (click / ⌘-click / shift-click / keyboard / marquee).
// Pure functions over the visible order; the app store holds the selection.

export type SelectMode = 'replace' | 'toggle' | 'range' | 'add';

export interface ClickMods {
  shift?: boolean;
  /** ⌘ on macOS, Ctrl elsewhere */
  toggle?: boolean;
}

/** Inclusive slice of `order` between `anchor` and `target`, in anchor → target direction. */
export function rangeBetween(order: readonly string[], anchor: string | null, target: string): string[] {
  const t = order.indexOf(target);
  if (t < 0) return [];
  const a = anchor ? order.indexOf(anchor) : -1;
  if (a < 0) return [target];
  if (a <= t) return order.slice(a, t + 1);
  return order.slice(t, a + 1).reverse();
}

/** What a click on `target` does to the selection. */
export function clickSelection(
  order: readonly string[],
  selection: readonly string[],
  anchor: string | null,
  target: string,
  mods: ClickMods,
): { paths: string[]; mode: SelectMode } {
  if (mods.shift && anchor && order.includes(anchor)) {
    const range = rangeBetween(order, anchor, target);
    if (mods.toggle) {
      const set = new Set(selection);
      for (const p of range) set.add(p);
      return { paths: [...set], mode: 'range' };
    }
    return { paths: range, mode: 'range' };
  }
  if (mods.toggle) return { paths: [target], mode: 'toggle' };
  return { paths: [target], mode: 'replace' };
}

/** The path `delta` steps from `current` (clamped), or the first/last when nothing is focused. */
export function stepFocus(order: readonly string[], current: string | null, delta: number): string | null {
  if (!order.length) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i < 0) return delta >= 0 ? order[0] : order[order.length - 1];
  return order[Math.max(0, Math.min(order.length - 1, i + delta))];
}

// ── marquee geometry ───────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface ItemRect {
  path: string;
  rect: Rect;
}

export function itemsInRect(items: readonly ItemRect[], sel: Rect): string[] {
  if (sel.w < 1 && sel.h < 1) return [];
  return items.filter((it) => intersects(it.rect, sel)).map((it) => it.path);
}

/** Row rects for a list: `top` is the content offset of the first row. */
export function listItemRects(paths: readonly string[], o: { top: number; rowHeight: number; left: number; width: number }): ItemRect[] {
  return paths.map((path, i) => ({ path, rect: { x: o.left, y: o.top + i * o.rowHeight, w: o.width, h: o.rowHeight } }));
}

/** Grid geometry: how many columns fit and how wide each tile is. */
export function gridColumns(width: number, o: { min: number; gap: number; pad: number }): { cols: number; tileW: number } {
  const inner = Math.max(0, width - o.pad * 2);
  const cols = Math.max(1, Math.floor((inner + o.gap) / (o.min + o.gap)));
  const tileW = cols > 0 ? (inner - o.gap * (cols - 1)) / cols : inner;
  return { cols, tileW: Math.max(0, tileW) };
}

/** Tile rects for one grid section laid out in rows starting at `top`. */
export function gridItemRects(
  paths: readonly string[],
  o: { top: number; cols: number; tileW: number; tileH: number; gap: number; pad: number },
): ItemRect[] {
  return paths.map((path, i) => {
    const r = Math.floor(i / o.cols);
    const c = i % o.cols;
    return { path, rect: { x: o.pad + c * (o.tileW + o.gap), y: o.top + r * (o.tileH + o.gap), w: o.tileW, h: o.tileH } };
  });
}

/** True when `p` is `root` or inside it (normalised paths). */
export function isSameOrInside(root: string, p: string): boolean {
  if (root === '/') return true;
  return p === root || p.startsWith(root + '/');
}

/** Paths that can move into `dest`: not the folder itself, not into its own subtree, not already there. */
export function movablePaths(paths: readonly string[], dest: string, parentOf: (p: string) => string): string[] {
  return paths.filter((p) => !isSameOrInside(p, dest) && parentOf(p) !== dest);
}

/** dataTransfer type for items dragged inside the drive (moves). */
export const DRAG_MIME = 'application/x-vx-paths';

export function isInternalDrag(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types ?? []).includes(DRAG_MIME);
}
