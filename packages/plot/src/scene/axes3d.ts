import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import { onScreen, type Frame } from './frame';
import { Layer } from './layers';
import { Stroke } from './strokes';
import type { Palette } from './theme';
import { decimalStep, type TickStep } from './ticks';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

const axisNames = ['x', 'y', 'z'] as const;
const labelGap = 14;
const nameGap = 36;
const minimumLabelSpacing = 26;
const tickLength = 0.03;
const maximumTicks = 96;

function ticks(box: Box, axis: number, step: TickStep): number[] {
  const indices: number[] = [];
  for (let index = Math.ceil(box.min[axis] / step.major - 1e-9); index * step.major <= box.max[axis] + 1e-9; index++) indices.push(index);
  return indices;
}

function faceGrid(box: Box, axis: number, side: 0 | 1, steps: TickStep[]): BufferGeometry {
  const positions: number[] = [];
  const level = side ? box.max[axis] : box.min[axis];
  const [u, v] = [0, 1, 2].filter(other => other !== axis);
  const push = (along: number, across: number, value: number) => {
    for (const end of [box.min[along], box.max[along]]) {
      const point = [0, 0, 0];
      point[axis] = level;
      point[across] = value;
      point[along] = end;
      positions.push(...point);
    }
  };
  for (const index of ticks(box, u, steps[u])) push(v, u, index * steps[u].major);
  for (const index of ticks(box, v, steps[v])) push(u, v, index * steps[v].major);
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
}

function boxEdges(box: Box): BufferGeometry {
  const positions: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [0, 1, 2].filter(other => other !== axis);
    for (const a of [box.min[u], box.max[u]]) {
      for (const b of [box.min[v], box.max[v]]) {
        for (const end of [box.min[axis], box.max[axis]]) {
          const point = [0, 0, 0];
          point[axis] = end;
          point[u] = a;
          point[v] = b;
          positions.push(...point);
        }
      }
    }
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
}

export class Axes3D {
  readonly object = new Group();
  readonly steps: TickStep[];
  private readonly faces: LineSegments[][] = [];
  private readonly origin: Stroke;
  private readonly materials: LineBasicMaterial[];
  private readonly tickPositions = new Float32BufferAttribute(new Float32Array(maximumTicks * 6), 3);
  private readonly tickMarks: LineSegments;

  constructor(private readonly box: Box, private readonly palette: Palette) {
    this.steps = [0, 1, 2].map(axis => decimalStep((box.max[axis] - box.min[axis]) / 7));
    const gridMaterial = new LineBasicMaterial({ color: palette.gridMinor.color.clone().lerp(palette.grid.color, 0.5) });
    const edgeMaterial = new LineBasicMaterial({ color: palette.grid.color });
    const tickMaterial = new LineBasicMaterial({ color: palette.grid.color.clone().lerp(palette.axis.color, 0.4) });
    this.materials = [gridMaterial, edgeMaterial, tickMaterial];
    for (let axis = 0; axis < 3; axis++) {
      const pair = ([0, 1] as const).map(side => new LineSegments(faceGrid(box, axis, side, this.steps), gridMaterial));
      this.faces.push(pair);
      this.object.add(...pair);
    }
    this.object.add(new LineSegments(boxEdges(box), edgeMaterial));
    this.tickMarks = new LineSegments(new BufferGeometry().setAttribute('position', this.tickPositions), tickMaterial);
    this.tickMarks.frustumCulled = false;
    this.object.add(this.tickMarks);
    this.origin = new Stroke(palette.axis.color, { width: 1.5, dimension: 3, layer: Layer.stroke });
    this.origin.setSegments(this.originSegments());
    this.object.add(this.origin.line);
  }

  update(frame: Frame, camera: Vector3): void {
    const center = this.center();
    this.faces.forEach((pair, axis) => {
      const back = camera.getComponent(axis) > center.getComponent(axis) ? 0 : 1;
      pair[0].visible = back === 0;
      pair[1].visible = back === 1;
    });
    this.origin.update(frame);
    this.placeLabels(frame, camera, center);
  }

  dispose(): void {
    this.object.traverse(child => {
      if (child instanceof LineSegments) child.geometry.dispose();
    });
    this.materials.forEach(material => material.dispose());
    this.origin.dispose();
  }

  private center(): Vector3 {
    const { min, max } = this.box;
    return new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  }

  private originSegments(): Float32Array {
    const { min, max } = this.box;
    const contains = (axis: number) => min[axis] <= 0 && max[axis] >= 0;
    const positions: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const others = [0, 1, 2].filter(other => other !== axis);
      if (!others.every(contains)) continue;
      for (const end of [min[axis], max[axis]]) {
        const point = [0, 0, 0];
        point[axis] = end;
        positions.push(...point);
      }
    }
    return new Float32Array(positions);
  }

  private placeLabels(frame: Frame, camera: Vector3, center: Vector3): void {
    const { min, max } = this.box;
    const extent = new Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    let count = 0;
    for (let axis = 0; axis < 3; axis++) {
      const { at, outward } = this.labelEdge(frame, camera, center, axis);
      const mark = outward.clone().divide(extent).normalize().multiply(extent).multiplyScalar(tickLength);
      const step = this.steps[axis];
      const first = frame.toScreen(at(0)), second = frame.toScreen(at(step.major));
      const stride = Math.ceil(minimumLabelSpacing / Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1e-6));
      for (const index of ticks(this.box, axis, step)) {
        const point = at(index * step.major);
        if (count < maximumTicks) {
          this.tickPositions.setXYZ(count * 2, point.x, point.y, point.z);
          this.tickPositions.setXYZ(count * 2 + 1, point.x + mark.x, point.y + mark.y, point.z + mark.z);
          count++;
        }
        if (index % stride === 0) this.place(frame, point, outward, labelGap, step.format(index), this.palette.label.css);
      }
      this.place(frame, at((min[axis] + max[axis]) / 2), outward, nameGap, axisNames[axis], this.palette.foreground.css);
    }
    this.tickPositions.needsUpdate = true;
    this.tickMarks.geometry.setDrawRange(0, count * 2);
  }

  private labelEdge(frame: Frame, camera: Vector3, center: Vector3, axis: number) {
    const { min, max } = this.box;
    const [first, second] = [0, 1, 2].filter(other => other !== axis);
    const facing = (other: number, high: boolean) => high ? camera.getComponent(other) > max[other] : camera.getComponent(other) < min[other];
    const point = (highFirst: boolean, highSecond: boolean, value: number) => new Vector3()
      .setComponent(axis, value)
      .setComponent(first, highFirst ? max[first] : min[first])
      .setComponent(second, highSecond ? max[second] : min[second]);
    const edges = [false, true].flatMap(highFirst => [false, true].map(highSecond => ({ highFirst, highSecond })));
    const silhouettes = edges.filter(edge => facing(first, edge.highFirst) !== facing(second, edge.highSecond));
    const middle = (min[axis] + max[axis]) / 2;
    const score = (edge: typeof edges[number]) => {
      const screen = frame.toScreen(point(edge.highFirst, edge.highSecond, middle));
      return axis === 2 ? -screen.x : screen.y;
    };
    const best = (silhouettes.length ? silhouettes : edges).reduce((a, b) => score(b) > score(a) ? b : a);
    const outward = point(best.highFirst, best.highSecond, middle).sub(center).setComponent(axis, 0);
    return { at: (value: number) => point(best.highFirst, best.highSecond, value), outward };
  }

  private place(frame: Frame, point: Vector3, outward: Vector3, gap: number, text: string, color: string): void {
    const anchor = frame.toScreen(point);
    if (!onScreen(anchor, frame, 40)) return;
    const reach = 0.02 * Math.max(...this.box.max.map((value, axis) => value - this.box.min[axis]));
    const away = frame.toScreen(point.clone().addScaledVector(outward.clone().normalize(), reach));
    const dx = away.x - anchor.x, dy = away.y - anchor.y, length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    frame.labels.add({
      text, color,
      x: anchor.x + ux * gap, y: anchor.y + uy * gap,
      alignX: 0.5 - ux * 0.5, alignY: 0.5 - uy * 0.5,
    });
  }
}
