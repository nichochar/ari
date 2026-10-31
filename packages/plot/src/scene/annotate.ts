import { Vector3 } from 'three';
import { onScreen, type Frame } from './frame';

export type Placement = 'beside' | 'center';

export interface ScreenSample { x: number; y: number; dx: number; dy: number; }

const placements: Record<Placement, { dx: number; dy: number; alignX: number; alignY: number }> = {
  beside: { dx: 8, dy: -6, alignX: 0, alignY: 1 },
  center: { dx: 0, dy: 0, alignX: 0.5, alignY: 0.5 },
};

const fractions = [0.8, 0.6, 0.4, 0.95];
const curveOffset = 10;
const inset = 12;
const scratch = new Vector3();

export function annotate(frame: Frame, point: Vector3, text: string, color: string, placement: Placement): void {
  const screen = frame.toScreen(point, scratch);
  if (!onScreen(screen, frame)) return;
  const { dx, dy, alignX, alignY } = placements[placement];
  frame.labels.add({ text, color, x: screen.x + dx, y: screen.y + dy, alignX, alignY });
}

export function segmentSamples(frame: Frame, positions: Float32Array, origin: Vector3): ScreenSample[] {
  const samples: ScreenSample[] = [];
  const start = new Vector3(), end = new Vector3();
  for (let i = 0; i < positions.length; i += 6) {
    frame.toScreen(start.fromArray(positions, i).add(origin), start);
    if (!onScreen(start, frame, -inset)) continue;
    frame.toScreen(end.fromArray(positions, i + 3).add(origin), end);
    samples.push({ x: start.x, y: start.y, dx: end.x - start.x, dy: end.y - start.y });
  }
  return samples;
}

export function labelAlong(frame: Frame, samples: ScreenSample[], text: string, color: string): void {
  if (!samples.length) return;
  const along = [0];
  for (let i = 1; i < samples.length; i++) {
    along.push(along[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  const total = along[along.length - 1];
  const candidates = fractions.map(fraction => {
    const index = Math.max(0, along.findIndex(distance => distance >= fraction * total));
    const { x, y, dx, dy } = samples[index];
    return Math.abs(dx) >= Math.abs(dy)
      ? { text, color, x, y: y - curveOffset, alignX: 0.5, alignY: 1 }
      : { text, color, x: x + curveOffset, y, alignX: 0, alignY: 0.5 };
  });
  frame.labels.add(candidates.find(candidate => frame.labels.fits(candidate, frame.width, frame.height)) ?? candidates[0]);
}
