import type { Frame, Snap } from './frame';
import type { View2D } from './view2d';

export interface HoverReadout {
  x: number;
  y: number;
  statement: number | null;
}

export const snapRadius = 12;

export function nearestOnSegments(
  positions: Float32Array, originX: number, originY: number, px: number, py: number, view: View2D, owner: Pick<Snap, 'statement' | 'color'>,
): Snap | null {
  let best: Snap | null = null;
  for (let i = 0; i < positions.length; i += 6) {
    const ax = view.pixelX(positions[i] + originX), ay = view.pixelY(positions[i + 1] + originY);
    const bx = view.pixelX(positions[i + 3] + originX), by = view.pixelY(positions[i + 4] + originY);
    const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (distance > snapRadius || best && distance >= best.distance) continue;
    best = {
      x: positions[i] + originX + t * (positions[i + 3] - positions[i]),
      y: positions[i + 1] + originY + t * (positions[i + 4] - positions[i + 1]),
      distance, ...owner,
    };
  }
  return best;
}

export function closestSnap(snaps: (Snap | null)[]): Snap | null {
  return snaps.reduce<Snap | null>((best, snap) => snap && (!best || snap.distance < best.distance) ? snap : best, null);
}

export function sameReadout(a: HoverReadout | null, b: HoverReadout | null): boolean {
  return a === b || !!a && !!b && a.x === b.x && a.y === b.y && a.statement === b.statement;
}

export function cursorReadout(frame: Frame, px: number, py: number): HoverReadout | null {
  return frame.view ? { x: frame.view.worldX(px), y: frame.view.worldY(py), statement: null } : null;
}
