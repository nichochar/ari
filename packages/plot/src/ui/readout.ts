import type { HoverReadout } from '../scene';
import { element } from './dom';
import { formatPoint } from './source';

export class Readout {
  readonly element = element('div', 'plot-readout');

  constructor() {
    this.element.setAttribute('aria-hidden', 'true');
  }

  show(readout: HoverReadout | null): void {
    if (readout) this.element.textContent = formatPoint(readout.x, readout.y);
    this.element.classList.toggle('plot-readout-visible', readout !== null);
  }
}
