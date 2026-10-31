import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, ShapeUtils, Vector2, Vector3 } from 'three';
import { annotate, type Placement } from './annotate';
import type { ElementContext, Style } from './context';
import { extentOf, type Extent, type Frame, type PlotElement, type Snap } from './frame';
import { nearestOnSegments, snapRadius } from './hover';
import { Layer, layer } from './layers';
import { Marker } from './markers';
import { polylineSegments, Stroke } from './strokes';

export type Coordinates = () => [number, number, number];

export class PointElement implements PlotElement {
  private readonly marker: Marker;
  private readonly position = new Vector3();

  constructor(private readonly at: Coordinates, private readonly style: Style, context: ElementContext) {
    this.marker = new Marker(style.color.color, context.palette.background.color, { dimension: context.dimension, diameter: 11 });
    this.refresh();
  }

  get object() {
    return this.marker.object;
  }

  refresh(): void {
    this.position.fromArray(this.at());
    this.marker.moveTo(this.position.x, this.position.y, this.position.z);
  }

  update(frame: Frame): void {
    this.marker.update(frame.pixelRatio);
    if (this.style.label) annotate(frame, this.position, this.style.label, this.style.color.css, 'beside');
  }

  snap(x: number, y: number, frame: Frame): Snap | null {
    const screen = frame.toScreen(this.position);
    const distance = Math.hypot(screen.x - x, screen.y - y);
    return distance <= snapRadius ? { x: this.position.x, y: this.position.y, distance: distance - 0.5, statement: this.style.statement, color: this.style.color.color } : null;
  }

  extent(): Extent | null {
    return extentOf([this.at()]);
  }

  dispose(): void {
    this.marker.dispose();
  }
}

export interface PathOptions {
  path: () => number[][];
  anchor?: () => { point: number[]; placement: Placement };
  fill?: boolean;
}

export class PathElement implements PlotElement {
  readonly object = new Group();
  private readonly stroke: Stroke;
  private readonly fill: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private positions: Float32Array = new Float32Array(0);
  private points: number[][] = [];

  constructor(private readonly options: PathOptions, private readonly style: Style, context: ElementContext) {
    this.stroke = new Stroke(style.color.color, { dashed: style.dashed, dimension: context.dimension, layer: Layer.stroke });
    this.object.add(this.stroke.line);
    if (options.fill) {
      const material = new MeshBasicMaterial({ color: style.color.color, transparent: true, opacity: 0.18, side: DoubleSide });
      layer(material, context.dimension, Layer.fill);
      this.fill = new Mesh(new BufferGeometry(), material);
      this.fill.renderOrder = Layer.fill;
      this.object.add(this.fill);
    }
    this.refresh();
  }

  refresh(): void {
    this.points = this.options.path();
    const finite = this.points.every(point => point.every(Number.isFinite));
    this.positions = finite ? polylineSegments([this.points]) : new Float32Array(0);
    this.stroke.setSegments(this.positions);
    if (this.fill) this.updateFill(finite);
  }

  update(frame: Frame): void {
    this.stroke.update(frame);
    if (!this.style.label || !this.options.anchor) return;
    const { point, placement } = this.options.anchor();
    if (point.every(Number.isFinite)) annotate(frame, new Vector3().fromArray(point), this.style.label, this.style.color.css, placement);
  }

  snap(x: number, y: number, frame: Frame): Snap | null {
    return frame.view ? nearestOnSegments(this.positions, 0, 0, x, y, frame.view, { statement: this.style.statement, color: this.style.color.color }) : null;
  }

  extent(): Extent | null {
    return extentOf(this.points);
  }

  dispose(): void {
    this.stroke.dispose();
    this.fill?.geometry.dispose();
    this.fill?.material.dispose();
  }

  private updateFill(finite: boolean): void {
    if (!this.fill) return;
    const contour = this.points.slice(0, -1).map(point => new Vector2(point[0], point[1]));
    const triangles = finite && contour.length >= 3 ? ShapeUtils.triangulateShape(contour, []) : [];
    const z = this.points[0]?.[2] ?? 0;
    const positions = triangles.flat().flatMap(index => [contour[index].x, contour[index].y, z]);
    this.fill.geometry.dispose();
    this.fill.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
  }
}

const headLength = 12;
const headHalfWidth = 4.5;

export class VectorElement implements PlotElement {
  readonly object = new Group();
  private readonly stroke: Stroke;
  private readonly head: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly headPositions = new Float32BufferAttribute(new Float32Array(9), 3);
  private from = new Vector3();
  private to = new Vector3();
  private drawnVersion = -1;

  constructor(private readonly ends: () => [number[], number[]], private readonly style: Style, context: ElementContext) {
    this.stroke = new Stroke(style.color.color, { dashed: style.dashed, dimension: context.dimension, layer: Layer.stroke });
    const material = new MeshBasicMaterial({ color: style.color.color, side: DoubleSide });
    layer(material, context.dimension, Layer.stroke);
    this.head = new Mesh(new BufferGeometry().setAttribute('position', this.headPositions), material);
    this.head.renderOrder = Layer.stroke;
    this.head.frustumCulled = false;
    this.object.add(this.stroke.line, this.head);
    this.refresh();
  }

  refresh(): void {
    const [from, to] = this.ends();
    this.from.fromArray(from);
    this.to.fromArray(to);
    this.drawnVersion = -1;
  }

  update(frame: Frame): void {
    if (this.drawnVersion !== frame.version) {
      this.drawnVersion = frame.version;
      this.draw(frame);
    }
    this.stroke.update(frame);
    if (this.style.label) annotate(frame, this.from.clone().lerp(this.to, 0.5), this.style.label, this.style.color.css, 'beside');
  }

  extent(): Extent | null {
    return extentOf([this.from.toArray(), this.to.toArray()]);
  }

  dispose(): void {
    this.stroke.dispose();
    this.head.geometry.dispose();
    this.head.material.dispose();
  }

  private draw(frame: Frame): void {
    const valid = [this.from, this.to].every(point => point.toArray().every(Number.isFinite));
    const tip = frame.toScreen(this.to), tail = frame.toScreen(this.from);
    const dx = tip.x - tail.x, dy = tip.y - tail.y, length = Math.hypot(dx, dy);
    this.head.visible = valid && length > 0;
    if (!this.head.visible) {
      this.stroke.setSegments(new Float32Array(0));
      return;
    }
    const ux = dx / length, uy = dy / length;
    const size = Math.min(headLength, length * 0.6), width = headHalfWidth * size / headLength;
    const baseX = tip.x - ux * size, baseY = tip.y - uy * size;
    const left = frame.fromScreen(baseX - uy * width, baseY + ux * width, tip.z);
    const right = frame.fromScreen(baseX + uy * width, baseY - ux * width, tip.z);
    const base = frame.fromScreen(baseX + ux * 1, baseY + uy * 1, tip.z);
    this.headPositions.setXYZ(0, this.to.x, this.to.y, this.to.z);
    this.headPositions.setXYZ(1, left.x, left.y, left.z);
    this.headPositions.setXYZ(2, right.x, right.y, right.z);
    this.headPositions.needsUpdate = true;
    this.stroke.setSegments(polylineSegments([[this.from.toArray(), base.toArray()]]));
  }
}

export class TextElement implements PlotElement {
  readonly object = new Group();
  private readonly position = new Vector3();

  constructor(private readonly text: string, private readonly at: Coordinates, private readonly color: string) {
    this.refresh();
  }

  refresh(): void {
    this.position.fromArray(this.at());
  }

  update(frame: Frame): void {
    if (this.position.toArray().every(Number.isFinite)) annotate(frame, this.position, this.text, this.color, 'center');
  }

  extent(): Extent | null {
    return extentOf([this.at()]);
  }

  dispose(): void {}
}

export function circlePath(center: number[], radius: number, from = 0, to = 2 * Math.PI): number[][] {
  const steps = Math.max(8, Math.ceil(Math.abs(to - from) / (2 * Math.PI) * 192));
  const points: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = from + (to - from) * i / steps;
    points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2] ?? 0]);
  }
  return points;
}
