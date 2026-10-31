import { Scene, WebGLRenderer } from 'three';
import type { PlotDocument } from '../language/types';
import { Bindings, type SceneCompiler } from './bindings';
import type { Box } from './axes3d';
import type { ElementContext } from './context';
import { assignSwatches, usesAngles, viewRanges } from './document';
import { buildElements } from './elements';
import { fitBox } from './fit3d';
import { prepareFocus } from './focus';
import { createFrame, type Frame, type PlotElement } from './frame';
import { closestSnap, cursorReadout, sameReadout, type HoverReadout } from './hover';
import { Implicit3DElement } from './implicit3d';
import { LabelLayer } from './labels';
import { Layer } from './layers';
import { Marker } from './markers';
import { Stage2D } from './stage2d';
import { settleDelay, Stage3D } from './stage3d';
import { Palette, readTheme, type PlotTheme } from './theme';

export type { HoverReadout } from './hover';
export type { PlotTheme } from './theme';
export type { SceneCompiler } from './bindings';
export { readTheme, seriesOrder } from './theme';

export interface SceneOptions {
  compile: SceneCompiler;
  theme?: () => PlotTheme;
  onHover?: (readout: HoverReadout | null) => void;
}

const maximumPixelRatio = 2;

export function statementSwatches(document: PlotDocument, theme: PlotTheme): (string | null)[] {
  return assignSwatches(document, new Palette(theme)).map(swatch => swatch?.css ?? null);
}

export class PlotScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly labels: LabelLayer;
  private readonly observer: ResizeObserver;
  private stage: Stage2D | Stage3D | null = null;
  private elements: PlotElement[] = [];
  private highlight: Marker | null = null;
  private document: PlotDocument | null = null;
  private bindings: Bindings | null = null;
  private parameters: Record<string, number> = {};
  private palette: Palette | null = null;
  private themeKey = '';
  private viewKey = '';
  private width = 0;
  private height = 0;
  private frameRequest = 0;
  private settleTimer = 0;
  private pointer: { x: number; y: number } | null = null;
  private readout: HoverReadout | null = null;

  constructor(private readonly host: HTMLElement, private readonly options: SceneOptions) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.localClippingEnabled = true;
    const canvas = this.renderer.domElement;
    prepareFocus(canvas);
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    host.append(canvas);
    this.labels = new LabelLayer(host);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerleave', this.pointerLeave);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.measure();
  }

  setDocument(document: PlotDocument, parameters: Record<string, number> = {}): void {
    this.document = document;
    this.parameters = parameters;
    const theme = this.options.theme?.() ?? readTheme(this.host);
    this.themeKey = JSON.stringify(theme);
    const palette = new Palette(theme);
    this.palette = palette;
    const bindings = new Bindings(this.options.compile, this.options.compile.scopeOf(document, parameters));
    this.bindings = bindings;
    this.clearElements();

    const ranges = viewRanges(document, bindings);
    const viewKey = `${document.dimension}:${JSON.stringify(ranges)}`;
    const keepView = viewKey === this.viewKey;
    this.viewKey = viewKey;
    const stage = this.stageFor(document.dimension);
    const box: Box = stage instanceof Stage3D ? fitBox(document, bindings, ranges) : { min: [0, 0, 0], max: [1, 1, 1] };
    if (stage instanceof Stage3D) stage.configure(palette, box, keepView);
    const context: ElementContext = {
      bindings, palette, box, dimension: document.dimension, swatches: assignSwatches(document, palette), steps: stage instanceof Stage3D ? stage.steps : [],
    };
    this.elements = buildElements(document, context);
    for (const element of this.elements) stage.content.add(element.object);
    if (stage instanceof Stage2D) {
      const extents = this.elements.flatMap(element => element.extent?.() ?? []);
      stage.configure(palette, usesAngles(document), { ranges, extents }, keepView);
      this.highlight = new Marker(palette.background.color, palette.background.color, { dimension: 2, diameter: 12, layer: Layer.highlight });
      this.highlight.object.visible = false;
      stage.root.add(this.highlight.object);
    }
    this.renderer.setClearColor(palette.background.color, 1);
    this.labels.setHalo(palette.background.css);
    this.invalidate();
  }

  setParameters(parameters: Record<string, number>): void {
    if (!this.document || !this.bindings) return;
    this.parameters = parameters;
    this.bindings.update(this.options.compile.scopeOf(this.document, parameters));
    for (const element of this.elements) element.refresh();
    this.invalidate();
  }

  resetView(): void {
    if (this.stage instanceof Stage2D) this.stage.resetView(true);
    else this.stage?.resetView();
  }

  resize(): void {
    const theme = this.options.theme?.() ?? readTheme(this.host);
    if (this.document && JSON.stringify(theme) !== this.themeKey) this.setDocument(this.document, this.parameters);
    this.measure();
    this.invalidate();
  }

  snapshot(): Promise<Blob> {
    this.draw(performance.now(), true);
    const source = this.renderer.domElement;
    const canvas = Object.assign(document.createElement('canvas'), { width: source.width, height: source.height });
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('Canvas 2D is unavailable.'));
    context.drawImage(source, 0, 0);
    this.labels.draw(context, this.renderer.getPixelRatio(), this.palette?.background.css ?? '#ffffff');
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Snapshot failed.')), 'image/png'));
  }

  dispose(): void {
    cancelAnimationFrame(this.frameRequest);
    clearTimeout(this.settleTimer);
    this.observer.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerleave', this.pointerLeave);
    this.clearElements();
    this.stage?.dispose();
    this.stage = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.labels.dispose();
  }

  private readonly invalidate = () => {
    if (!this.frameRequest) this.frameRequest = requestAnimationFrame(time => this.draw(time, false));
  };

  private stageFor(dimension: 2 | 3): Stage2D | Stage3D {
    if (this.stage?.dimension === dimension) return this.stage;
    if (this.stage) {
      this.scene.remove(this.stage.root);
      this.stage.dispose();
    }
    const canvas = this.renderer.domElement;
    this.stage = dimension === 2 ? new Stage2D(canvas, this.invalidate) : new Stage3D(canvas, this.invalidate);
    this.stage.resize(this.width, this.height);
    this.scene.add(this.stage.root);
    return this.stage;
  }

  private clearElements(): void {
    for (const element of this.elements) {
      element.object.removeFromParent();
      element.dispose();
    }
    this.elements = [];
    if (this.highlight) {
      this.highlight.object.removeFromParent();
      this.highlight.dispose();
      this.highlight = null;
    }
  }

  private measure(): void {
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    this.renderer.setPixelRatio(this.pixelRatio(true));
    this.renderer.setSize(this.width, this.height, false);
    this.stage?.resize(this.width, this.height);
  }

  private pixelRatio(settled: boolean): number {
    const full = Math.min(maximumPixelRatio, window.devicePixelRatio || 1);
    const raymarching = this.elements.some(element => element instanceof Implicit3DElement);
    return settled || !raymarching ? full : 1;
  }

  private draw(time: number, settled: boolean): void {
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    const stage = this.stage;
    if (!stage || this.width === 0 || this.height === 0) return;
    const animating = stage instanceof Stage3D ? stage.step() : stage.step(time);
    const calm = settled || !(stage instanceof Stage3D) || stage.settled(performance.now());
    const pixelRatio = this.pixelRatio(calm);
    if (pixelRatio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(this.width, this.height, false);
    }
    if (!calm) {
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(this.invalidate, settleDelay + 20);
    }
    stage.prepare();
    this.scene.updateMatrixWorld();
    const frame = createFrame({
      width: this.width, height: this.height, pixelRatio, camera: stage.camera, view: stage.view,
      version: stage instanceof Stage3D ? stage.version : stage.view.version, labels: this.labels,
    }, stage.content);
    this.labels.begin(pixelRatio);
    stage.update(frame);
    for (const element of this.elements) element.update(frame);
    this.updateHover(frame, stage);
    this.labels.commit();
    this.renderer.render(this.scene, stage.camera);
    if (animating) this.invalidate();
  }

  private updateHover(frame: Frame, stage: Stage2D | Stage3D): void {
    let readout: HoverReadout | null = null;
    const highlight = this.highlight;
    if (highlight) highlight.object.visible = false;
    if (this.pointer && stage instanceof Stage2D && !stage.dragging) {
      const { x, y } = this.pointer;
      const snap = closestSnap(this.elements.map(element => element.snap?.(x, y, frame) ?? null));
      readout = snap ? { x: snap.x, y: snap.y, statement: snap.statement } : cursorReadout(frame, x, y);
      if (snap && highlight) {
        highlight.color = snap.color;
        highlight.moveTo(snap.x, snap.y, 0);
        highlight.update(frame.pixelRatio);
      }
    }
    if (!sameReadout(readout, this.readout)) {
      this.readout = readout;
      this.options.onHover?.(readout);
    }
  }

  private readonly pointerMove = (event: PointerEvent) => {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.invalidate();
  };

  private readonly pointerLeave = () => {
    this.pointer = null;
    this.invalidate();
  };
}
