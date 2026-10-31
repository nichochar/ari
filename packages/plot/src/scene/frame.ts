import { Matrix4, Vector3, type Camera, type Color, type Object3D } from 'three';
import type { LabelLayer } from './labels';
import type { View2D } from './view2d';

export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly camera: Camera;
  readonly view: View2D | null;
  readonly version: number;
  readonly labels: LabelLayer;
  toScreen(point: Vector3, target?: Vector3): Vector3;
  fromScreen(x: number, y: number, depth: number, target?: Vector3): Vector3;
}

export interface Snap {
  x: number;
  y: number;
  distance: number;
  statement: number;
  color: Color;
}

export interface Extent {
  min: [number, number];
  max: [number, number];
}

export interface PlotElement {
  readonly object: Object3D;
  refresh(): void;
  update(frame: Frame): void;
  snap?(x: number, y: number, frame: Frame): Snap | null;
  extent?(): Extent | null;
  dispose(): void;
}

export function createFrame(options: Omit<Frame, 'toScreen' | 'fromScreen'>, content: Object3D): Frame {
  const { camera, width, height } = options;
  const inverse = new Matrix4().copy(content.matrixWorld).invert();
  return {
    ...options,
    toScreen(point, target = new Vector3()) {
      target.copy(point).applyMatrix4(content.matrixWorld).project(camera);
      return target.set((target.x + 1) / 2 * width, (1 - target.y) / 2 * height, target.z);
    },
    fromScreen(x, y, depth, target = new Vector3()) {
      return target.set(x / width * 2 - 1, 1 - y / height * 2, depth).unproject(camera).applyMatrix4(inverse);
    },
  };
}

export function onScreen(point: Vector3, frame: Frame, margin = 0): boolean {
  return point.z > -1 && point.z < 1 && point.x >= -margin && point.y >= -margin
    && point.x <= frame.width + margin && point.y <= frame.height + margin;
}

export function extentOf(points: number[][]): Extent | null {
  const finite = points.filter(point => point.slice(0, 2).every(Number.isFinite));
  if (!finite.length) return null;
  const xs = finite.map(point => point[0]), ys = finite.map(point => point[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}
