'use client';

// Drag-rectangle marquee (DESIGN-v2 §6.2): a 1 px accent border, a 40 % accent-wash fill, r4.
import type { Rect } from '@/lib/drive/selection';

export default function SelectionRect({ rect }: { rect: Rect | null }) {
  if (!rect || (rect.w < 2 && rect.h < 2)) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-[4px] border border-vx-accent bg-vx-accent-wash/40"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  );
}
