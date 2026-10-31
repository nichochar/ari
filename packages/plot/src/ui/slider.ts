import { element } from './dom';
import { iconButton, setIcon } from './icons';
import type { SliderModel } from './model';

export interface SliderHandlers {
  input: (name: string, value: number) => void;
  release: (name: string) => void;
  togglePlay: (name: string) => void;
}

export class SliderView {
  readonly element = element('div', 'plot-slider');
  private readonly input = element('input', 'plot-range');
  private readonly play: HTMLButtonElement;

  constructor(private readonly model: SliderModel, playing: boolean, handlers: SliderHandlers) {
    const { input } = this;
    input.type = 'range';
    input.min = String(model.min);
    input.max = String(model.max);
    input.step = String(model.step);
    input.setAttribute('aria-label', model.name);
    input.dataset.plotFocus = `slider:${model.name}`;
    input.addEventListener('input', () => handlers.input(model.name, input.valueAsNumber));
    input.addEventListener('change', () => handlers.release(model.name));
    this.play = iconButton('play', '', () => handlers.togglePlay(model.name));
    this.play.dataset.plotFocus = `play:${model.name}`;
    this.element.append(input, this.play);
    this.setValue(model.value);
    this.setPlaying(playing);
  }

  setValue(value: number): void {
    const { min, max } = this.model;
    if (this.input.valueAsNumber !== value) this.input.value = String(value);
    const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));
    this.input.style.setProperty('--plot-fill', `${fraction * 100}%`);
  }

  setPlaying(playing: boolean): void {
    setIcon(this.play, playing ? 'pause' : 'play');
    const label = `${playing ? 'Pause' : 'Play'} ${this.model.name}`;
    this.play.setAttribute('aria-label', label);
    this.play.title = label;
  }
}
