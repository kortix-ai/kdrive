'use client';

// Drag-rectangle marquee: 1 px dashed accent edge, accent wash fill.
import type { Rect } from '@/lib/drive/selection';

export default function SelectionRect({ rect }: { rect: Rect | null }) {
  if (!rect || (rect.w < 2 && rect.h < 2)) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 border border-dashed border-vx-accent-edge bg-vx-accent-wash"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  );
}
