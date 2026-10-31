import { InstancedInterleavedBuffer, InterleavedBufferAttribute, Vector3, type Color, type Plane } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Frame } from './frame';
import { layer, type Layer } from './layers';

export interface StrokeOptions {
  width?: number;
  dashed?: boolean;
  dimension: 2 | 3;
  layer: Layer;
  clipping?: Plane[];
}

const dash = 7;
const gap = 5;

export class Stroke {
  readonly line: LineSegments2;
  private readonly material: LineMaterial;
  private positions: Float32Array = new Float32Array(0);
  private dashVersion = -1;

  constructor(color: Color, private readonly options: StrokeOptions) {
    this.material = new LineMaterial({
      color, linewidth: options.width ?? 2.25, dashed: options.dashed ?? false, dashSize: dash, gapSize: gap, dashScale: 1, worldUnits: false,
    });
    if (options.clipping) this.material.clippingPlanes = options.clipping;
    layer(this.material, options.dimension, options.layer);
    this.line = new LineSegments2(new LineSegmentsGeometry(), this.material);
    this.line.renderOrder = options.layer;
    this.line.visible = false;
  }

  setSegments(positions: Float32Array, origin?: Vector3): void {
    this.positions = positions;
    this.line.visible = positions.length > 0;
    if (origin) this.line.position.copy(origin);
    const geometry = new LineSegmentsGeometry();
    if (positions.length) geometry.setPositions(positions);
    this.line.geometry.dispose();
    this.line.geometry = geometry;
    this.dashVersion = -1;
  }

  update(frame: Frame): void {
    this.material.resolution.set(frame.width, frame.height);
    if (this.options.dashed && this.positions.length && this.dashVersion !== frame.version) {
      this.dashVersion = frame.version;
      this.measureDashes(frame);
    }
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.material.dispose();
  }

  private measureDashes(frame: Frame): void {
    const distances = new Float32Array(this.positions.length / 3);
    const start = new Vector3(), end = new Vector3(), point = new Vector3();
    let total = 0;
    for (let i = 0; i < distances.length; i += 2) {
      point.fromArray(this.positions, i * 3).add(this.line.position);
      frame.toScreen(point, start);
      point.fromArray(this.positions, i * 3 + 3).add(this.line.position);
      frame.toScreen(point, end);
      distances[i] = total;
      total += Math.hypot(end.x - start.x, end.y - start.y);
      distances[i + 1] = total;
    }
    const buffer = new InstancedInterleavedBuffer(distances, 2, 1);
    this.line.geometry.setAttribute('instanceDistanceStart', new InterleavedBufferAttribute(buffer, 1, 0));
    this.line.geometry.setAttribute('instanceDistanceEnd', new InterleavedBufferAttribute(buffer, 1, 1));
  }
}

export function polylineSegments(lines: number[][][]): Float32Array {
  const count = lines.reduce((sum, line) => sum + Math.max(0, line.length - 1), 0);
  const positions = new Float32Array(count * 6);
  let offset = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      for (const point of [line[i], line[i + 1]]) {
        positions[offset++] = point[0];
        positions[offset++] = point[1];
        positions[offset++] = point[2] ?? 0;
      }
    }
  }
  return positions;
}
