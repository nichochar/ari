import { Vector3 } from 'three';
import { labelAlong, segmentSamples } from './annotate';
import type { ElementContext, Style } from './context';
import type { Extent, Frame, PlotElement, Snap } from './frame';
import { nearestOnSegments } from './hover';
import { Layer } from './layers';
import { clipSegment, sampleCurve, type Point, type Rect } from './sampling';
import { unitClipping } from './stage3d';
import { Stroke } from './strokes';
import type { View2D } from './view2d';

export interface CurveSource {
  evaluate(t: number): Point;
  domain(): [number, number];
  follows: 'x' | 'y' | null;
}

const breakLength = 12;
const parametricSamples = 1000;
const clampHeights = 1000;
const extentSamples = 256;

export class CurveElement implements PlotElement {
  private readonly stroke: Stroke;
  private positions: Float32Array = new Float32Array(0);
  private readonly origin = new Vector3();
  private sampledVersion = -1;
  private dirty = true;

  constructor(private readonly source: CurveSource, private readonly style: Style, private readonly context: ElementContext) {
    this.stroke = new Stroke(style.color.color, {
      dashed: style.dashed, dimension: context.dimension, layer: Layer.stroke,
      clipping: context.dimension === 3 ? unitClipping : undefined,
    });
  }

  get object() {
    return this.stroke.line;
  }

  refresh(): void {
    this.dirty = true;
  }

  update(frame: Frame): void {
    if (this.dirty || frame.view && frame.version !== this.sampledVersion) {
      this.sampledVersion = frame.version;
      this.dirty = false;
      this.resample(frame.view);
    }
    this.stroke.update(frame);
    if (this.style.label) this.placeLabel(frame, this.style.label);
  }

  snap(x: number, y: number, frame: Frame): Snap | null {
    if (!frame.view) return null;
    return nearestOnSegments(this.positions, this.origin.x, this.origin.y, x, y, frame.view, { statement: this.style.statement, color: this.style.color.color });
  }

  extent(): Extent | null {
    if (this.source.follows) {
      const [start, end] = this.source.domain();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return this.source.follows === 'x' ? { min: [start, 0], max: [end, 0] } : { min: [0, start], max: [0, end] };
    }
    const [start, end] = this.source.domain();
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i <= extentSamples; i++) {
      const [x, y] = this.source.evaluate(start + (end - start) * i / extentSamples);
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
    return xs.length ? { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] } : null;
  }

  dispose(): void {
    this.stroke.dispose();
  }

  private resample(view: View2D | null): void {
    const lines = view ? this.sample2d(view) : this.sample3d();
    this.positions = this.toSegments(lines, view);
    this.stroke.setSegments(this.positions, this.origin);
  }

  private sample2d(view: View2D): Point[][] {
    const [domainStart, domainEnd] = this.source.domain();
    const margin = 0.5;
    const rangeOf = (min: number, max: number): [number, number] => {
      const pad = (max - min) * margin;
      return [Math.max(domainStart, min - pad), Math.min(domainEnd, max + pad)];
    };
    const [start, end] = this.source.follows === 'x' ? rangeOf(view.minX, view.maxX)
      : this.source.follows === 'y' ? rangeOf(view.minY, view.maxY)
      : [domainStart, domainEnd];
    if (!(end > start)) return [];
    const spacing = this.source.follows === 'x' ? 2 / view.scaleX
      : this.source.follows === 'y' ? 2 / view.scaleY
      : (end - start) / parametricSamples;
    const limitX = clampHeights * view.width, limitY = clampHeights * view.height;
    const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
    const padX = view.width * margin, padY = view.height * margin;
    return sampleCurve(start, end, {
      evaluate: this.source.evaluate,
      measure: ([x, y]) => [clamp(view.pixelX(x), limitX), clamp(view.pixelY(y), limitY)],
      outside: ([x, y]) => (x < -padX ? 1 : 0) | (x > view.width + padX ? 2 : 0) | (y < -padY ? 4 : 0) | (y > view.height + padY ? 8 : 0),
      spacing, breakLength,
    });
  }

  private sample3d(): Point[][] {
    const [start, end] = this.source.domain();
    if (!(end > start)) return [];
    const { min, max } = this.context.box;
    return sampleCurve(start, end, {
      evaluate: this.source.evaluate,
      measure: point => point.map((value, axis) => (value - min[axis]) / (max[axis] - min[axis]) * 400),
      spacing: (end - start) / parametricSamples, breakLength: 40,
    });
  }

  private toSegments(lines: Point[][], view: View2D | null): Float32Array {
    if (!view) {
      this.origin.set(0, 0, 0);
      const values: number[] = [];
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) values.push(line[i][0], line[i][1], line[i][2] ?? 0, line[i + 1][0], line[i + 1][1], line[i + 1][2] ?? 0);
      }
      return new Float32Array(values);
    }
    this.origin.set(view.centerX, view.centerY, 0);
    const padX = (view.maxX - view.minX) * 0.5, padY = (view.maxY - view.minY) * 0.5;
    const rect: Rect = { minX: view.minX - padX, maxX: view.maxX + padX, minY: view.minY - padY, maxY: view.maxY + padY };
    const values: number[] = [];
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1];
        const clipped = clipSegment(a, b, rect);
        if (!clipped) continue;
        const [t0, t1] = clipped;
        values.push(
          a[0] + (b[0] - a[0]) * t0 - this.origin.x, a[1] + (b[1] - a[1]) * t0 - this.origin.y, 0,
          a[0] + (b[0] - a[0]) * t1 - this.origin.x, a[1] + (b[1] - a[1]) * t1 - this.origin.y, 0,
        );
      }
    }
    return new Float32Array(values);
  }

  private placeLabel(frame: Frame, text: string): void {
    labelAlong(frame, segmentSamples(frame, this.positions, this.origin), text, this.style.color.css);
  }
}
