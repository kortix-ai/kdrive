// HTML labels anchored to the field (LANDING-SPEC §5.6): the hover tag with a
// 24px leader, and the version labels of an open fan with a leader per row.
// The fan's rows are placed once, when the plan is made (fan-layout.ts); per
// frame they only follow the volume's small drift (±16px) and each leader
// re-aims at its live slice corner. Only transforms are written per frame, and
// only when a value changed. Sizes come from the mono advance (no layout reads).
import { overlaps, violation, type Rect, type Zones } from './exclusion';
import { captionLines } from './chooser';
import type { FanPlan } from './fan-plan';
import { ADV, type Pt } from './fan-layout';

const TAG_H = 44;
const LEAD = 17; // 24px diagonal
const FOLLOW = 16;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

class Tx {
  private last = '';
  constructor(readonly node: HTMLElement) {}
  set(v: string): void {
    if (v !== this.last) this.node.style.transform = this.last = v;
  }
}

interface Row { box: HTMLDivElement; text: HTMLSpanElement; lead: HTMLElement; tBox: Tx; tLead: Tx; on: boolean }

export class Labels {
  private readonly tag: HTMLDivElement;
  private readonly tagTx: Tx;
  private readonly tagL1: HTMLElement;
  private readonly tagL2: HTMLElement;
  private tagW = 0;
  /** Which corner the tag hangs from: 0 top-right, 1 top-left, 2 bottom-right, 3 bottom-left. */
  private tagCorner = 0;
  private tagOn = false;
  private readonly rows: Row[] = [];
  private plan: FanPlan | null = null;
  private readonly caption: HTMLDivElement;
  private readonly capL1: HTMLElement;
  private readonly capL2: HTMLElement;

  constructor(private readonly layer: HTMLElement, count: number) {
    this.tag = el('div', 'kd-hero__tag', layer);
    this.tagTx = new Tx(this.tag);
    el('i', 'kd-hero__tag-lead', this.tag);
    const box = el('span', 'kd-hero__tag-box', this.tag);
    this.tagL1 = el('b', '', box);
    this.tagL2 = el('span', '', box);
    // where no labels fit beside a stack (small phone bands), one caption in the hint's place
    this.caption = el('div', 'kd-hero__caption', layer);
    this.capL1 = el('b', '', this.caption);
    this.capL2 = el('span', '', this.caption);
    for (let i = 0; i < count; i++) {
      const lead = el('i', 'kd-hero__fan-lead', layer);
      const b = el('div', 'kd-hero__fan-row', layer);
      const text = el('span', '', b);
      this.rows.push({ box: b, text, lead, tBox: new Tx(b), tLead: new Tx(lead), on: false });
    }
  }

  setTag(line1: string | null, line2 = ''): void {
    const on = !!line1;
    if (line1 && this.tagL1.textContent !== line1) {
      this.tagL1.textContent = line1;
      this.tagL2.textContent = line2;
      this.tagW = Math.max(line1.length, line2.length) * ADV + 20;
    }
    if (on !== this.tagOn) this.tag.classList.toggle('is-on', (this.tagOn = on));
  }

  /**
   * Place the tag beside its volume, from one of its four outer corners in
   * order (top-right, top-left, bottom-right, bottom-left) with the 24px
   * diagonal leader: the first that clears the copy, the nav, the frame, its
   * own cube and every other cube's projected box wins; when none is clear,
   * the least bad (keeping the one shown on a tie, so it never flickers).
   */
  placeTag(corners: Pt[], z: Zones, cubes: Rect[], own: Rect): void {
    if (!this.tagOn) return;
    const top = z.nav.y1 + LEAD + TAG_H;
    const bottom = z.safe.y1 - LEAD - TAG_H;
    const at = (i: number): Pt => {
      const p = corners[i];
      const goLeft = i % 2 === 1;
      const x = goLeft ? Math.max(p.x, z.safe.x0 + LEAD + this.tagW) : Math.min(p.x, z.safe.x1 - LEAD - this.tagW);
      return { x, y: i < 2 ? Math.max(p.y, top) : Math.min(p.y, bottom) };
    };
    const box = (i: number): Rect => {
      const p = at(i);
      const [x0, x1] = i % 2 === 1 ? [p.x - LEAD - this.tagW, p.x - LEAD] : [p.x + LEAD, p.x + LEAD + this.tagW];
      const [y0, y1] = i < 2 ? [p.y - LEAD - TAG_H, p.y - LEAD] : [p.y + LEAD, p.y + LEAD + TAG_H];
      return { x0, y0, x1, y1 };
    };
    const bad = (r: Rect) =>
      violation(r, { ...z, copy: z.copy.map(shrink) }) +
      cubes.reduce((a, c) => a + (overlaps(r, c) ? 400 : 0), 0) +
      (overlaps(r, inset(own)) ? 600 : 0);
    const scores = [0, 1, 2, 3].map((i) => bad(box(i)));
    let pick = scores.findIndex((s) => s === 0);
    if (pick < 0) {
      pick = this.tagCorner;
      for (let i = 0; i < 4; i++) if (scores[i] < scores[pick]) pick = i;
    }
    if (pick !== this.tagCorner) {
      this.tagCorner = pick;
      this.tag.classList.toggle('is-left', pick % 2 === 1);
      this.tag.classList.toggle('is-below', pick >= 2);
    }
    const p = at(pick);
    this.tagTx.set(`translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`);
  }

  /** A new fan: the row texts and styles (state change only, never per frame). */
  setFan(plan: FanPlan | null, name = ''): void {
    this.plan = plan;
    const cap = !!plan?.caption && plan.labels.length > 0;
    if (cap && plan) {
      // beside its stack when the plan found room there; else the hint's place
      const at = plan.captionAt;
      [this.capL1.textContent, this.capL2.textContent] = captionLines(name, plan.labels, !!at);
      this.caption.classList.toggle('is-placed', !!at);
      this.caption.style.transform = at ? `translate3d(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px,0)` : '';
    }
    this.caption.classList.toggle('is-on', cap);
    this.rows.forEach((r, i) => {
      const l = plan?.layout ? plan.labels[i] : undefined;
      r.text.textContent = l?.text ?? '';
      r.box.classList.toggle('is-bright', !!l?.bright);
      r.box.classList.toggle('is-row', plan?.layout?.mode === 'row');
      if (!l) this.showRow(r, false);
    });
  }

  private showRow(r: Row, on: boolean): void {
    if (on === r.on) return;
    r.on = on;
    r.box.classList.toggle('is-on', on);
    r.lead.classList.toggle('is-on', on);
  }

  /**
   * Draw the planned rows, shifted by the volume's drift from its planned
   * centre (clamped to ±16px), each leader from its live slice corner.
   * `anchor(slice)` gives that corner; `on(slice)` whether the slice is open.
   * Returns the rows' rect (for the hold-while-hovered test).
   */
  placeFan(centre: Pt, anchor: (slice: number) => Pt, on: (slice: number) => boolean): Rect | null {
    const p = this.plan;
    if (p?.caption) {
      const show = p.labels.length > 0 && on(0);
      if (show !== this.caption.classList.contains('is-on')) this.caption.classList.toggle('is-on', show);
      return null;
    }
    const L = p?.layout;
    if (!p || !L) return null;
    const dx = clampAbs(centre.x - p.centre.x, FOLLOW);
    const dy = clampAbs(centre.y - p.centre.y, FOLLOW);
    for (const row of L.rows) {
      const r = this.rows[row.label];
      if (!r) continue;
      const x = row.x + dx;
      const y = row.y + dy;
      this.showRow(r, on(row.slice));
      r.tBox.set(`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(${row.align > 0 ? 0 : -100}%,-50%)`);
      const a = anchor(row.slice);
      // column rows are met at their near edge; stacked rows from below (or above)
      const tx = L.mode === 'column' ? x - 6 * row.align : x + 4 * row.align;
      const ty = L.mode === 'column' ? y : y + (L.attach === 'top' ? 10 : -10);
      const lx = tx - a.x;
      const ly = ty - a.y;
      r.tLead.set(`translate3d(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px,0) rotate(${Math.atan2(ly, lx).toFixed(4)}rad) scaleX(${Math.hypot(lx, ly).toFixed(1)})`);
    }
    return { x0: L.rect.x0 + dx, y0: L.rect.y0 + dy, x1: L.rect.x1 + dx, y1: L.rect.y1 + dy };
  }

  hideFan(): void {
    this.caption.classList.remove('is-on');
    for (const r of this.rows) this.showRow(r, false);
  }

  dispose(): void {
    this.layer.replaceChildren();
  }
}

const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** A volume's own box, less its empty bounding corners (an iso cube does not fill its box). */
const inset = (r: Rect): Rect => {
  const dx = (r.x1 - r.x0) * 0.12;
  const dy = (r.y1 - r.y0) * 0.12;
  return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 - dx, y1: r.y1 - dy };
};

/** Tags may sit a little closer to the copy than volumes do. */
const shrink = (r: Rect): Rect => ({ x0: r.x0 + 16, y0: r.y0 + 16, x1: r.x1 - 16, y1: r.y1 - 16 });
