import * as compile from '../compile';
import type { PlotDocument } from '../language/types';
import { PlotScene, readTheme, type HoverReadout, type PlotTheme } from '../scene';
import { element } from './dom';

const sleepDelay = 1000;

export class Stage {
  readonly element = element('div', 'plot-stage');
  private readonly host = element('div', 'plot-canvas');
  private readonly observer: IntersectionObserver;
  private scene: PlotScene | null = null;
  private still: { image: HTMLImageElement; blob: Blob; url: string } | null = null;
  private document: PlotDocument | null = null;
  private parameters: Record<string, number> = {};
  private visible = false;
  private sleepTimer = 0;

  constructor(root: HTMLElement, private readonly onHover: (readout: HoverReadout | null) => void) {
    this.element.append(this.host);
    this.observer = new IntersectionObserver(([entry]) => this.observe(entry.isIntersecting), { rootMargin: '200px' });
    this.observer.observe(root);
  }

  theme(): PlotTheme {
    return readTheme(this.host);
  }

  setDocument(document: PlotDocument, parameters: Record<string, number>): void {
    this.document = document;
    this.parameters = parameters;
    this.scene?.setDocument(document, parameters);
  }

  setParameters(parameters: Record<string, number>): void {
    this.parameters = parameters;
    this.scene?.setParameters(parameters);
  }

  setHeight(height: number): void {
    this.element.style.height = `${height}px`;
    this.resize();
  }

  resetView(): void {
    this.scene?.resetView();
  }

  resize(): void {
    this.scene?.resize();
  }

  snapshot(): Promise<Blob> {
    if (this.scene) return this.scene.snapshot();
    if (this.still) return Promise.resolve(this.still.blob);
    return Promise.reject(new Error('The plot has no image yet.'));
  }

  dispose(): void {
    clearTimeout(this.sleepTimer);
    this.observer.disconnect();
    this.scene?.dispose();
    this.scene = null;
    this.clearStill();
    this.element.remove();
  }

  private observe(visible: boolean): void {
    this.visible = visible;
    clearTimeout(this.sleepTimer);
    if (visible) this.wake();
    else if (this.scene) this.sleepTimer = window.setTimeout(() => void this.sleep(), sleepDelay);
  }

  private async sleep(): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    const blob = await scene.snapshot().catch(() => null);
    if (this.visible || this.scene !== scene) return;
    if (blob) {
      const url = URL.createObjectURL(blob);
      const image = element('img', 'plot-still');
      image.alt = '';
      image.src = url;
      this.clearStill();
      this.still = { image, blob, url };
      this.host.append(image);
    }
    this.onHover(null);
    scene.dispose();
    this.scene = null;
  }

  private wake(): void {
    if (this.scene) return;
    this.scene = new PlotScene(this.host, { compile, onHover: this.onHover });
    if (this.document) this.scene.setDocument(this.document, this.parameters);
    const still = this.still;
    if (still) requestAnimationFrame(() => { if (this.still === still) this.clearStill(); });
  }

  private clearStill(): void {
    if (!this.still) return;
    this.still.image.remove();
    URL.revokeObjectURL(this.still.url);
    this.still = null;
  }
}
