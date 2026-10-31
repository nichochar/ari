import { parsePlot } from './language/parse';
import type { PlotDocument, Statement } from './language/types';
import { statementSwatches } from './scene';
import { element } from './ui/dom';
import { buildRows, type RowModel } from './ui/model';
import { Playback } from './ui/playback';
import { Readout } from './ui/readout';
import { Rows } from './ui/rows';
import { appendLine, formatValue, replaceLine, setParameterValue, snapValue, sourceLines, toggleHidden } from './ui/source';
import { Stage } from './ui/stage';
import { Toolbar } from './ui/toolbar';

export interface PlotOptions {
  /** The plot block text, without the fence. */
  source: string;
  /** Called whenever the learner changes the source through the UI (expression edits, sliders, visibility, reset). */
  onSourceChange?: (source: string) => void;
  /** When given, shows an "Ask" action; receives the current source and a PNG snapshot of the view. */
  onAsk?: (source: string, snapshot: Blob) => void;
  /** When given, shows an expand action. */
  onExpand?: () => void;
  /** Show expressions without editing them; sliders still move the plot but never change the source. */
  readOnly?: boolean;
  /** Pixel height of the canvas area. Width follows the container. */
  height?: number;
  /** Render LaTeX for expression rows. Defaults to plain text when absent. */
  renderLatex?: (latex: string, element: HTMLElement) => void;
}

export interface PlotHandle {
  /** Replace the source, keeping camera and slider state where the lines still match. */
  setSource(source: string): void;
  getSource(): string;
  /** Source as originally mounted; differs from getSource() once edited. */
  getOriginalSource(): string;
  reset(): void;
  snapshot(): Promise<Blob>;
  /** Move the plot into another container, e.g. a dialog, without losing state. */
  moveTo(container: HTMLElement): void;
  resize(): void;
  /** Change the canvas height, e.g. when moved into a dialog. */
  setHeight(height: number): void;
  destroy(): void;
}

type Parameter = Extract<Statement, { type: 'parameter' }>;

function parameterNamed(document: PlotDocument, name: string): Parameter | undefined {
  return document.statements.find((statement): statement is Parameter => statement.type === 'parameter' && statement.name === name);
}

function unchanged(previous: PlotDocument, next: PlotDocument, name: string): boolean {
  const before = parameterNamed(previous, name), after = parameterNamed(next, name);
  return !!before && !!after && !!after.range && before.source === after.source;
}

export function mountPlot(container: HTMLElement, options: PlotOptions): PlotHandle {
  const readOnly = options.readOnly ?? false;
  let original = options.source;
  let source = options.source;
  let document = parsePlot(source);
  let values: Record<string, number> = {};
  let models: RowModel[] = [];

  const root = element('div', 'plot-root');
  const readout = new Readout();
  const stage = new Stage(root, hover => readout.show(hover));
  const playback = new Playback((name, value) => setValue(name, value));
  const ask = options.onAsk;
  const toolbar = new Toolbar({
    resetView: () => stage.resetView(),
    resetEdits: readOnly ? undefined : () => resetEdits(),
    expand: options.onExpand,
    ask: ask && (() => stage.snapshot().then(blob => ask(source, blob))),
  });
  const rows = new Rows({
    readOnly,
    renderLatex: options.renderLatex,
    commit: (line, text) => change(line === null ? appendLine(source, text) : replaceLine(source, line, text)),
    toggleHidden: line => change(replaceLine(source, line, toggleHidden(sourceLines(source)[line - 1] ?? ''))),
    isPlaying: name => playback.isPlaying(name),
    input: (name, value) => {
      stopPlaying(name);
      setValue(name, value);
    },
    release: name => writeValue(name),
    togglePlay: name => {
      if (playback.isPlaying(name)) {
        stopPlaying(name);
        writeValue(name);
        return;
      }
      const slider = models.find(row => row.slider?.name === name)?.slider;
      if (!slider) return;
      playback.start(name, slider, values[name] ?? slider.value);
      rows.setPlaying(name, true);
    },
  });

  stage.element.style.height = `${options.height ?? 320}px`;
  stage.element.append(toolbar.element, readout.element);
  root.append(stage.element, rows.element);
  container.append(root);
  load(source, false);

  function load(next: string, keepValues: boolean): void {
    const previous = document;
    source = next;
    document = parsePlot(next);
    values = keepValues ? Object.fromEntries(Object.entries(values).filter(([name]) => unchanged(previous, document, name))) : {};
    for (const name of playback.names()) if (!(name in values)) playback.stop(name);
    stage.setDocument(document, values);
    refreshRows();
    toolbar.setEdited(source !== original);
  }

  function change(next: string): void {
    if (next === source) return;
    load(next, true);
    options.onSourceChange?.(next);
  }

  function resetEdits(): void {
    const edited = source !== original;
    load(original, false);
    if (edited) options.onSourceChange?.(original);
  }

  function refreshRows(): void {
    models = buildRows(source, document, statementSwatches(document, stage.theme()), values);
    rows.render(models);
  }

  function setValue(name: string, value: number): void {
    values = { ...values, [name]: value };
    stage.setParameters(values);
    rows.showValue(name, value);
  }

  function stopPlaying(name: string): void {
    if (!playback.isPlaying(name)) return;
    playback.stop(name);
    rows.setPlaying(name, false);
  }

  function writeValue(name: string): void {
    const row = models.find(model => model.slider?.name === name);
    const value = values[name];
    if (readOnly || !row?.slider || value === undefined) return;
    const { min, step } = row.slider;
    const text = formatValue(snapValue(value, min, step), step);
    change(replaceLine(source, row.line, setParameterValue(sourceLines(source)[row.line - 1] ?? '', text)));
  }

  return {
    setSource(next) {
      if (next === source) return;
      original = next;
      load(next, true);
    },
    getSource: () => source,
    getOriginalSource: () => original,
    reset: resetEdits,
    snapshot: () => stage.snapshot(),
    moveTo(target) {
      target.append(root);
      stage.resize();
    },
    resize() {
      stage.resize();
      refreshRows();
    },
    setHeight: height => stage.setHeight(height),
    destroy() {
      playback.stopAll();
      stage.dispose();
      root.remove();
    },
  };
}
