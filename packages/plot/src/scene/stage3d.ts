import { Group, PerspectiveCamera, Plane, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Axes3D, type Box } from './axes3d';
import { ownsWheel } from './focus';
import type { Frame } from './frame';
import type { Palette } from './theme';

const azimuth = Math.PI / 4;
const elevation = 25 * Math.PI / 180;

export const settleDelay = 150;

export const unitClipping = [
  new Plane(new Vector3(1, 0, 0), 1.001), new Plane(new Vector3(-1, 0, 0), 1.001),
  new Plane(new Vector3(0, 1, 0), 1.001), new Plane(new Vector3(0, -1, 0), 1.001),
  new Plane(new Vector3(0, 0, 1), 1.001), new Plane(new Vector3(0, 0, -1), 1.001),
];

export class Stage3D {
  readonly dimension = 3;
  readonly view = null;
  readonly camera = new PerspectiveCamera(40, 1, 0.01, 100);
  readonly root = new Group();
  readonly content = new Group();
  readonly dragging = false;
  moved = false;
  version = 0;
  private axes: Axes3D | null = null;
  private readonly controls: OrbitControls;
  private lastInput = -Infinity;
  private boxKey = '';

  constructor(private readonly canvas: HTMLCanvasElement, private readonly invalidate: () => void) {
    this.camera.up.set(0, 0, 1);
    this.root.add(this.content);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.05, zoomToCursor: true, screenSpacePanning: true,
      minPolarAngle: 0.01, maxPolarAngle: Math.PI - 0.01, minDistance: 0.6, maxDistance: 30,
    });
    canvas.addEventListener('wheel', this.gateWheel, { capture: true });
    this.controls.addEventListener('start', this.input);
    this.controls.addEventListener('change', this.input);
    canvas.addEventListener('dblclick', this.reset);
  }

  configure(palette: Palette, box: Box, keepView: boolean): void {
    if (this.axes) {
      this.content.remove(this.axes.object);
      this.axes.dispose();
    }
    this.axes = new Axes3D(box, palette);
    this.content.add(this.axes.object);
    this.content.scale.set(...box.max.map((value, axis) => 2 / (value - box.min[axis])) as [number, number, number]);
    this.content.position.set(...box.max.map((value, axis) => -(value + box.min[axis]) / 2 * this.content.scale.getComponent(axis)) as [number, number, number]);
    this.content.updateMatrixWorld(true);
    const key = JSON.stringify(box);
    if (!keepView || !this.moved || key !== this.boxKey) this.resetView();
    this.boxKey = key;
  }

  get steps() {
    return this.axes?.steps ?? [];
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.version++;
    if (!this.moved) this.resetView();
  }

  resetView(): void {
    const vertical = this.camera.fov * Math.PI / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const distance = 1.05 * Math.sqrt(3) / Math.sin(Math.min(vertical, horizontal) / 2);
    this.camera.position.set(
      Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation),
    ).multiplyScalar(distance);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.moved = false;
    this.version++;
    this.invalidate();
  }

  settled(time: number): boolean {
    return time - this.lastInput > settleDelay;
  }

  step(): boolean {
    return this.controls.update();
  }

  prepare(): void {
    this.camera.updateMatrixWorld();
  }

  update(frame: Frame): void {
    this.axes?.update(frame, this.content.worldToLocal(this.camera.position.clone()));
  }

  dispose(): void {
    this.controls.removeEventListener('start', this.input);
    this.controls.removeEventListener('change', this.input);
    this.controls.domElement?.removeEventListener('dblclick', this.reset);
    this.controls.domElement?.removeEventListener('wheel', this.gateWheel, { capture: true });
    this.controls.dispose();
    this.axes?.dispose();
  }

  private readonly input = () => {
    this.moved = true;
    this.version++;
    this.lastInput = performance.now();
    this.invalidate();
  };

  private readonly reset = () => this.resetView();

  private readonly gateWheel = (event: Event) => {
    if (event instanceof WheelEvent && !ownsWheel(event, this.canvas)) event.stopImmediatePropagation();
  };
}
