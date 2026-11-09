import { statementLatex } from '../compile';
import { element } from './dom';
import { createEditor } from './editor';
import { iconButton } from './icons';
import type { RowModel } from './model';
import { SliderView, type SliderHandlers } from './slider';
import { formatValue, setParameterValue } from './source';

export interface RowsOptions extends SliderHandlers {
  readOnly: boolean;
  renderLatex?: (latex: string, element: HTMLElement) => void;
  commit: (line: number | null, text: string) => void;
  toggleHidden: (line: number) => void;
  isPlaying: (name: string) => boolean;
}

type Editing = number | 'new' | null;

interface ParameterRow { row: RowModel; content: HTMLElement; slider: SliderView; }

const inlineRowLimit = 3;
const visibleSliderLimit = 2;
let nextListId = 0;

export class Rows {
  readonly element = element('div', 'plot-rows');
  private readonly controls = element('div', 'plot-row-controls');
  private readonly toggle = element('button', 'plot-rows-toggle');
  private readonly list = element('div', 'plot-row-list');
  private readonly panel = element('div', 'plot-row-panel', this.list);
  private expanded?: boolean;
  private expressionCount = 0;
  private models: RowModel[] = [];
  private editing: Editing = null;
  private pendingFocus: string | null = null;
  private readonly parameters = new Map<string, ParameterRow>();

  constructor(private readonly options: RowsOptions) {
    this.panel.id = `ari-plot-expressions-${++nextListId}`;
    this.toggle.type = 'button';
    this.toggle.setAttribute('aria-controls', this.panel.id);
    this.toggle.addEventListener('click', () => {
      this.element.classList.add('plot-rows-animated');
      this.expanded = this.panel.inert;
      this.updateDisclosure();
    });
    this.element.append(this.controls, this.toggle, this.panel);
  }

  render(models: RowModel[]): void {
    this.models = models;
    const active = document.activeElement;
    const focus = this.pendingFocus
      ?? (active instanceof HTMLElement && this.element.contains(active) ? active.dataset.plotFocus ?? null : null);
    this.pendingFocus = null;
    this.parameters.clear();
    const collapsible = models.length > inlineRowLimit;
    const controls: HTMLElement[] = [];
    const children: HTMLElement[] = [];
    for (const row of models) {
      const node = this.editing === row.line ? this.editorRow(row.line, row.text) : this.row(row);
      if (collapsible && row.slider && controls.length < visibleSliderLimit) controls.push(node);
      else children.push(node);
    }
    this.expressionCount = children.length;
    if (this.editing === 'new') children.push(this.editorRow('new', ''));
    if (!this.options.readOnly) children.push(this.addRow());
    this.controls.replaceChildren(...controls);
    this.list.replaceChildren(...children);
    this.toggle.hidden = !collapsible;
    this.updateDisclosure();
    const target = focus ? this.element.querySelector<HTMLElement>(`[data-plot-focus="${CSS.escape(focus)}"]`) : null;
    if (target && this.panel.inert && this.panel.contains(target)) this.toggle.focus({ preventScroll: true });
    else target?.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement && target.type === 'text') target.setSelectionRange(target.value.length, target.value.length);
  }

  private updateDisclosure(): void {
    const open = this.toggle.hidden || (this.expanded ?? this.models.some(row => row.errors.length > 0));
    this.panel.inert = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.textContent = open ? 'Hide expressions' : `Show ${this.expressionCount} expressions`;
  }

  showValue(name: string, value: number): void {
    const entry = this.parameters.get(name);
    if (!entry) return;
    entry.slider.setValue(value);
    this.renderContent(entry.content, entry.row, value);
  }

  setPlaying(name: string, playing: boolean): void {
    this.parameters.get(name)?.slider.setPlaying(playing);
  }

  private row(row: RowModel): HTMLElement {
    const content = element('div', 'plot-row-content');
    const main = element('div', 'plot-row-main', this.swatch(row), content);
    const container = element('div', 'plot-row', main);
    this.renderContent(content, row, row.slider?.value);
    if (!this.options.readOnly) {
      content.tabIndex = 0;
      content.setAttribute('role', 'button');
      content.setAttribute('aria-label', `Edit ${row.text}`);
      content.dataset.plotFocus = `content:${row.line}`;
      content.addEventListener('click', () => this.edit(row.line));
      content.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.edit(row.line);
      });
    }
    if (row.slider) {
      const slider = new SliderView(row.slider, this.options.isPlaying(row.slider.name), this.options);
      this.parameters.set(row.slider.name, { row, content, slider });
      container.append(slider.element);
    }
    for (const message of row.errors) container.append(element('div', 'plot-row-error', message));
    return container;
  }

  private swatch(row: RowModel): HTMLElement {
    const hidden = row.statement?.attributes.hidden ?? false;
    if (!row.color) return element('span', 'plot-gutter');
    const disc = element('span', hidden ? 'plot-swatch plot-swatch-hidden' : 'plot-swatch');
    disc.style.setProperty('--plot-swatch', row.color);
    if (this.options.readOnly) return element('span', 'plot-gutter', disc);
    const button = element('button', 'plot-gutter plot-swatch-button', disc);
    button.type = 'button';
    button.setAttribute('aria-label', hidden ? 'Show' : 'Hide');
    button.setAttribute('aria-pressed', String(!hidden));
    button.dataset.plotFocus = `swatch:${row.line}`;
    button.addEventListener('click', () => this.options.toggleHidden(row.line));
    return button;
  }

  private renderContent(target: HTMLElement, row: RowModel, value: number | undefined): void {
    const { statement, slider } = row;
    const { renderLatex } = this.options;
    const shown = slider && value !== undefined ? formatValue(value, slider.step) : null;
    if (statement && renderLatex && row.errors.length === 0) {
      const current = statement.type === 'parameter' && shown !== null ? { ...statement, value: { kind: 'number' as const, value: Number(shown) } } : statement;
      renderLatex(statementLatex(current), target);
      return;
    }
    target.replaceChildren(element('span', 'plot-row-source', shown === null ? row.text : setParameterValue(row.text, shown)));
  }

  private editorRow(line: number | 'new', text: string): HTMLElement {
    const input = createEditor(text, (result, keyboard) => {
      this.editing = null;
      if (keyboard) this.pendingFocus = line === 'new' ? 'add' : `content:${line}`;
      if (result === null || result === text) this.render(this.models);
      else this.options.commit(line === 'new' ? null : line, result);
    });
    input.dataset.plotFocus = 'editor';
    return element('div', 'plot-row', element('div', 'plot-row-main', element('span', 'plot-gutter'), input));
  }

  private addRow(): HTMLElement {
    const button = iconButton('add', 'Add expression', () => this.edit('new'));
    button.dataset.plotFocus = 'add';
    return element('div', 'plot-row plot-row-add', button);
  }

  private edit(target: Editing): void {
    if (target === 'new') this.expanded = true;
    this.editing = target;
    this.pendingFocus = 'editor';
    this.render(this.models);
  }
}
