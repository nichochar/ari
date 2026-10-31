import { Group, OrthographicCamera } from 'three';
import { Axes2D } from './axes2d';
import { Controls2D } from './controls2d';
import type { Extent, Frame } from './frame';
import type { Palette } from './theme';
import { View2D, type ViewState } from './view2d';

export type Ranges = Partial<Record<'x' | 'y' | 'z', [number, number]>>;

export interface Home2D {
  ranges: Ranges;
  extents: Extent[];
}

const defaultRange: [number, number] = [-5, 5];
const padding = 0.08;

export class Stage2D {
  readonly dimension = 2;
  readonly view = new View2D();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  readonly root = new Group();
  readonly content = new Group();
  moved = false;
  private axes: Axes2D | null = null;
  private home: Home2D = { ranges: {}, extents: [] };
  private readonly controls: Controls2D;

  constructor(canvas: HTMLCanvasElement, private readonly invalidate: () => void) {
    this.root.add(this.content);
    this.controls = new Controls2D(canvas, this.view, () => {
      this.moved = true;
      invalidate();
    }, () => this.resetView(true));
  }

  get dragging(): boolean {
    return this.controls.dragging;
  }

  configure(palette: Palette, pi: boolean, home: Home2D, keepView: boolean): void {
    if (this.axes) {
      this.root.remove(this.axes.object);
      this.axes.dispose();
    }
    this.axes = new Axes2D(palette, pi);
    this.root.add(this.axes.object);
    this.home = home;
    if (!keepView || !this.moved) this.resetView(false);
  }

  resize(width: number, height: number): void {
    this.view.resize(width, height);
    if (!this.moved) this.view.set(this.homeState());
  }

  resetView(animate = false): void {
    this.moved = false;
    if (animate) this.view.animateTo(this.homeState(), performance.now());
    else this.view.set(this.homeState());
    this.invalidate();
  }

  step(time: number): boolean {
    const animating = this.view.step(time);
    return this.controls.step(time) || animating;
  }

  prepare(): void {
    this.view.apply(this.camera);
  }

  update(frame: Frame): void {
    this.axes?.update(frame, this.view);
  }

  dispose(): void {
    this.controls.dispose();
    this.axes?.dispose();
  }

  private homeState(): ViewState {
    const { x, y } = this.home.ranges;
    if (x || y) return this.view.fit(x ?? [0, 0], y ?? [0, 0]);
    let minX = defaultRange[0], maxX = defaultRange[1], minY = 0, maxY = 0;
    for (const extent of this.home.extents) {
      const padX = (extent.max[0] - extent.min[0]) * padding, padY = (extent.max[1] - extent.min[1]) * padding;
      minX = Math.min(minX, extent.min[0] - padX);
      maxX = Math.max(maxX, extent.max[0] + padX);
      minY = Math.min(minY, extent.min[1] - padY);
      maxY = Math.max(maxY, extent.max[1] + padY);
    }
    return this.view.fit([minX, maxX], [minY, maxY]);
  }
}
