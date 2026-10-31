import { Color, SRGBColorSpace } from 'three';
import type { Color as ColorName } from '../language/types';

export interface PlotTheme {
  background: string;
  foreground: string;
  grid: string;
  gridMinor: string;
  axis: string;
  label: string;
  surfaceLight: string;
  series: string[];
}

export const seriesOrder = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow'] as const;

const lightTheme: PlotTheme = {
  background: '#ffffff', foreground: '#1f2328', grid: '#d3d7de', gridMinor: '#eceef2', axis: '#3d4350', label: '#4b5260',
  surfaceLight: '#ffffff',
  series: ['#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c', '#0d9488', '#db2777', '#ca8a04'],
};

const darkTheme: PlotTheme = {
  background: '#16181d', foreground: '#e6e8eb', grid: '#383c46', gridMinor: '#24272e', axis: '#b4bac5', label: '#a3a9b5',
  surfaceLight: '#ffffff',
  series: ['#60a5fa', '#f87171', '#4ade80', '#a78bfa', '#fb923c', '#2dd4bf', '#f472b6', '#facc15'],
};

export function readTheme(host: HTMLElement): PlotTheme {
  const style = getComputedStyle(host);
  const fallback = matchMedia('(prefers-color-scheme: dark)').matches ? darkTheme : lightTheme;
  const read = (name: string, value: string) => style.getPropertyValue(name).trim() || value;
  return {
    background: read('--plot-bg', fallback.background),
    foreground: read('--plot-fg', fallback.foreground),
    grid: read('--plot-grid', fallback.grid),
    gridMinor: read('--plot-grid-minor', fallback.gridMinor),
    axis: read('--plot-axis', fallback.axis),
    label: read('--plot-label', fallback.label),
    surfaceLight: read('--plot-surface-light', fallback.surfaceLight),
    series: fallback.series.map((value, index) => read(`--plot-series-${index + 1}`, value)),
  };
}

let probe: CanvasRenderingContext2D | null = null;

function opaque(css: string, under: string): string {
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!probe) return css;
  probe.fillStyle = under;
  probe.fillRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export interface Swatch { color: Color; css: string; }

function swatch(css: string): Swatch {
  return { color: new Color().setStyle(css, SRGBColorSpace), css };
}

export class Palette {
  readonly background: Swatch;
  readonly foreground: Swatch;
  readonly grid: Swatch;
  readonly gridMinor: Swatch;
  readonly axis: Swatch;
  readonly label: Swatch;
  readonly surfaceLight: Swatch;
  readonly series: Swatch[];
  readonly dark: boolean;
  private next = 0;

  constructor(readonly theme: PlotTheme) {
    const background = opaque(theme.background, '#ffffff');
    const resolve = (css: string) => swatch(opaque(css, background));
    this.background = swatch(background);
    this.foreground = resolve(theme.foreground);
    this.grid = resolve(theme.grid);
    this.gridMinor = resolve(theme.gridMinor);
    this.axis = resolve(theme.axis);
    this.label = resolve(theme.label);
    this.surfaceLight = resolve(theme.surfaceLight);
    this.series = theme.series.map(resolve);
    const { r, g, b } = this.background.color;
    this.dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2;
  }

  pick(name: ColorName | undefined): Swatch {
    if (name === 'gray') return this.axis;
    if (name?.startsWith('#')) return swatch(opaque(name, this.background.css));
    const named = seriesOrder.findIndex(entry => entry === name);
    if (named >= 0) return this.series[named % this.series.length];
    return this.series[this.next++ % this.series.length];
  }
}
