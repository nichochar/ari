import type { OrthographicCamera } from 'three';

export interface ViewState { centerX: number; centerY: number; scaleX: number; scaleY: number; }

interface Transition { from: ViewState; to: ViewState; start: number; duration: number; }

const minimumScale = 1e-9;
const maximumScale = 1e12;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export class View2D implements ViewState {
  centerX = 0;
  centerY = 0;
  scaleX = 50;
  scaleY = 50;
  width = 1;
  height = 1;
  version = 0;
  private transition: Transition | null = null;

  get minX() { return this.centerX - this.width / 2 / this.scaleX; }
  get maxX() { return this.centerX + this.width / 2 / this.scaleX; }
  get minY() { return this.centerY - this.height / 2 / this.scaleY; }
  get maxY() { return this.centerY + this.height / 2 / this.scaleY; }

  pixelX(x: number) { return (x - this.centerX) * this.scaleX + this.width / 2; }
  pixelY(y: number) { return (this.centerY - y) * this.scaleY + this.height / 2; }
  worldX(px: number) { return (px - this.width / 2) / this.scaleX + this.centerX; }
  worldY(py: number) { return this.centerY - (py - this.height / 2) / this.scaleY; }

  state(): ViewState {
    return { centerX: this.centerX, centerY: this.centerY, scaleX: this.scaleX, scaleY: this.scaleY };
  }

  set(state: ViewState): void {
    this.centerX = state.centerX;
    this.centerY = state.centerY;
    this.scaleX = clampScale(state.scaleX);
    this.scaleY = clampScale(state.scaleY);
    this.version++;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.version++;
  }

  pan(dx: number, dy: number): void {
    this.transition = null;
    this.set({ ...this.state(), centerX: this.centerX - dx / this.scaleX, centerY: this.centerY + dy / this.scaleY });
  }

  zoomAt(px: number, py: number, factor: number): void {
    this.transition = null;
    const x = this.worldX(px), y = this.worldY(py);
    const ratio = clampScale(this.scaleX * factor) / this.scaleX;
    const scaleX = this.scaleX * ratio, scaleY = clampScale(this.scaleY * ratio);
    this.set({
      scaleX, scaleY,
      centerX: x - (px - this.width / 2) / scaleX,
      centerY: y + (py - this.height / 2) / scaleY,
    });
  }

  fit(xRange: [number, number], yRange: [number, number]): ViewState {
    const xSpan = xRange[1] - xRange[0], ySpan = yRange[1] - yRange[0];
    const scale = Math.min(xSpan > 0 ? this.width / xSpan : Infinity, ySpan > 0 ? this.height / ySpan : Infinity);
    return {
      centerX: (xRange[0] + xRange[1]) / 2,
      centerY: (yRange[0] + yRange[1]) / 2,
      scaleX: Number.isFinite(scale) ? scale : 50,
      scaleY: Number.isFinite(scale) ? scale : 50,
    };
  }

  animateTo(target: ViewState, time: number, duration = 250): void {
    this.transition = { from: this.state(), to: target, start: time, duration };
  }

  step(time: number): boolean {
    if (!this.transition) return false;
    const { from, to, start, duration } = this.transition;
    const t = easeOut(Math.min(1, (time - start) / duration));
    const logLerp = (a: number, b: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
    this.set({
      centerX: from.centerX + (to.centerX - from.centerX) * t,
      centerY: from.centerY + (to.centerY - from.centerY) * t,
      scaleX: logLerp(from.scaleX, to.scaleX),
      scaleY: logLerp(from.scaleY, to.scaleY),
    });
    if (t >= 1) this.transition = null;
    return this.transition !== null;
  }

  apply(camera: OrthographicCamera): void {
    camera.position.set(this.centerX, this.centerY, 1);
    camera.left = -this.width / 2 / this.scaleX;
    camera.right = this.width / 2 / this.scaleX;
    camera.top = this.height / 2 / this.scaleY;
    camera.bottom = -this.height / 2 / this.scaleY;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
}

function clampScale(scale: number): number {
  return Math.min(maximumScale, Math.max(minimumScale, scale));
}
