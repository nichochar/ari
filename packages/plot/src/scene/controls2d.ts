import { ownsWheel } from './focus';
import type { View2D } from './view2d';

interface Sample { time: number; x: number; y: number; }

const momentumWindow = 80;
const momentumStale = 50;
const friction = 325;
const maximumSpeed = 5;
const stopSpeed = 0.005;

export class Controls2D {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private samples: Sample[] = [];
  private velocity: { x: number; y: number } | null = null;
  private lastStep = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: View2D,
    private readonly onChange: () => void,
    private readonly onReset: () => void,
  ) {
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerUp);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('dblclick', this.onReset);
    canvas.addEventListener('keydown', this.keyDown);
  }

  get dragging(): boolean {
    return this.pointers.size > 0;
  }

  step(time: number): boolean {
    if (!this.velocity) return false;
    const dt = Math.min(64, time - this.lastStep);
    this.lastStep = time;
    this.view.pan(this.velocity.x * dt, this.velocity.y * dt);
    const decay = Math.exp(-dt / friction);
    this.velocity.x *= decay;
    this.velocity.y *= decay;
    if (Math.hypot(this.velocity.x, this.velocity.y) < stopSpeed) this.velocity = null;
    this.onChange();
    return this.velocity !== null;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointermove', this.pointerMove);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointercancel', this.pointerUp);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('dblclick', this.onReset);
    this.canvas.removeEventListener('keydown', this.keyDown);
  }

  private local(event: PointerEvent | WheelEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private centroid() {
    const points = [...this.pointers.values()];
    const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const spread = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    return { x, y, spread };
  }

  private readonly pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.canvas.setPointerCapture(event.pointerId);
    this.velocity = null;
    this.pointers.set(event.pointerId, this.local(event));
    this.samples = [];
  };

  private readonly pointerMove = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    const before = this.centroid();
    this.pointers.set(event.pointerId, this.local(event));
    const after = this.centroid();
    this.view.pan(after.x - before.x, after.y - before.y);
    if (before.spread > 0 && after.spread > 0) this.view.zoomAt(after.x, after.y, after.spread / before.spread);
    const time = performance.now();
    this.samples.push({ time, x: after.x, y: after.y });
    this.samples = this.samples.filter(sample => time - sample.time <= momentumWindow);
    this.onChange();
  };

  private readonly pointerUp = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (this.pointers.size > 0) {
      this.samples = [];
      return;
    }
    if (event.pointerType === 'mouse') this.samples = [];
    else this.launch();
  };

  private launch(): void {
    const now = performance.now();
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    this.samples = [];
    if (!first || !last || now - last.time > momentumStale || last.time - first.time < 8) return;
    const elapsed = last.time - first.time;
    let x = (last.x - first.x) / elapsed, y = (last.y - first.y) / elapsed;
    const speed = Math.hypot(x, y);
    if (speed < 0.05) return;
    if (speed > maximumSpeed) { x *= maximumSpeed / speed; y *= maximumSpeed / speed; }
    this.velocity = { x, y };
    this.lastStep = now;
    this.onChange();
  }

  private readonly wheel = (event: WheelEvent) => {
    if (!ownsWheel(event, this.canvas)) return;
    event.preventDefault();
    this.velocity = null;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
    const { x, y } = this.local(event);
    this.view.zoomAt(x, y, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)));
    this.onChange();
  };

  private readonly keyDown = (event: KeyboardEvent) => {
    const { width, height } = this.view;
    const fraction = event.shiftKey ? 0.5 : event.altKey ? 0.02 : 0.1;
    const pans: Record<string, [number, number]> = {
      ArrowLeft: [width * fraction, 0], ArrowRight: [-width * fraction, 0],
      ArrowUp: [0, height * fraction], ArrowDown: [0, -height * fraction],
    };
    const zooms: Record<string, number> = { '+': 1.25, '=': 1.25, '-': 1 / 1.25, '_': 1 / 1.25 };
    if (event.key in pans) this.view.pan(...pans[event.key]);
    else if (event.key in zooms) this.view.zoomAt(width / 2, height / 2, zooms[event.key]);
    else if (event.key === '0') { this.onReset(); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    this.velocity = null;
    this.onChange();
  };
}
