export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  alignX: number;
  alignY: number;
  color: string;
  opacity: number;
}

export interface Rect { left: number; top: number; right: number; bottom: number; }

type LabelInput = Omit<PlacedLabel, 'opacity'> & { opacity?: number };

const lineHeight = 14;
const clearance = 3;

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export class LabelLayer {
  readonly element = document.createElement('div');
  private readonly spans: HTMLSpanElement[] = [];
  private placed: PlacedLabel[] = [];
  private reserved: Rect[] = [];
  private shown = 0;
  private pixelRatio = 1;
  private measure: CanvasRenderingContext2D | null = null;
  private readonly widths = new Map<string, number>();

  constructor(host: HTMLElement) {
    Object.assign(this.element.style, {
      position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none',
      fontSize: '12px', lineHeight: '1.2', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    });
    host.append(this.element);
  }

  setHalo(background: string): void {
    this.element.style.textShadow = `0 0 2px ${background}, 0 0 2px ${background}, 0 0 1px ${background}`;
  }

  begin(pixelRatio: number): void {
    this.placed = [];
    this.reserved = [];
    this.pixelRatio = pixelRatio;
  }

  add(label: LabelInput): void {
    this.placed.push({ opacity: 1, ...label });
  }

  reserve(rect: Rect): void {
    this.reserved.push(rect);
  }

  fits(label: Pick<PlacedLabel, 'text' | 'x' | 'y' | 'alignX' | 'alignY'>, width: number, height: number): boolean {
    const rect = this.bounds(label);
    if (rect.left < 0 || rect.top < 0 || rect.right > width || rect.bottom > height) return false;
    return ![...this.reserved, ...this.placed.map(placed => this.bounds(placed))].some(other => overlaps(rect, other));
  }

  commit(): void {
    const round = (value: number) => Math.round(value * this.pixelRatio) / this.pixelRatio;
    this.placed.forEach((label, index) => {
      const span = this.spans[index] ?? this.createSpan();
      if (span.textContent !== label.text) span.textContent = label.text;
      span.style.transform = `translate(${round(label.x)}px, ${round(label.y)}px) translate(${-label.alignX * 100}%, ${-label.alignY * 100}%)`;
      span.style.color = label.color;
      span.style.opacity = String(label.opacity);
      if (index >= this.shown) span.style.display = '';
    });
    for (let index = this.placed.length; index < this.shown; index++) this.spans[index].style.display = 'none';
    this.shown = this.placed.length;
  }

  draw(context: CanvasRenderingContext2D, pixelRatio: number, background: string): void {
    const style = getComputedStyle(this.element);
    context.save();
    context.scale(pixelRatio, pixelRatio);
    context.font = `${style.fontSize} ${style.fontFamily}`;
    context.lineJoin = 'round';
    context.lineWidth = 3;
    context.strokeStyle = background;
    for (const label of this.placed) {
      context.globalAlpha = label.opacity;
      context.textAlign = label.alignX < 0.25 ? 'left' : label.alignX > 0.75 ? 'right' : 'center';
      context.textBaseline = label.alignY < 0.25 ? 'top' : label.alignY > 0.75 ? 'bottom' : 'middle';
      context.fillStyle = label.color;
      context.strokeText(label.text, label.x, label.y);
      context.fillText(label.text, label.x, label.y);
    }
    context.restore();
  }

  dispose(): void {
    this.element.remove();
  }

  private bounds(label: Pick<PlacedLabel, 'text' | 'x' | 'y' | 'alignX' | 'alignY'>): Rect {
    const width = this.textWidth(label.text);
    const left = label.x - label.alignX * width, top = label.y - label.alignY * lineHeight;
    return { left: left - clearance, top: top - clearance, right: left + width + clearance, bottom: top + lineHeight + clearance };
  }

  private textWidth(text: string): number {
    const known = this.widths.get(text);
    if (known !== undefined) return known;
    this.measure ??= document.createElement('canvas').getContext('2d');
    if (!this.measure) return text.length * 7;
    const style = getComputedStyle(this.element);
    this.measure.font = `${style.fontSize} ${style.fontFamily}`;
    const width = this.measure.measureText(text).width;
    this.widths.set(text, width);
    return width;
  }

  private createSpan(): HTMLSpanElement {
    const span = document.createElement('span');
    Object.assign(span.style, { position: 'absolute', left: '0', top: '0' });
    this.element.append(span);
    this.spans.push(span);
    return span;
  }
}
