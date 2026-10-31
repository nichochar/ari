import type { Box } from './axes3d';
import type { Bindings } from './bindings';
import type { Palette, Swatch } from './theme';
import type { TickStep } from './ticks';

export interface ElementContext {
  bindings: Bindings;
  palette: Palette;
  dimension: 2 | 3;
  box: Box;
  steps: TickStep[];
  swatches: (Swatch | null)[];
}

export interface Style {
  statement: number;
  color: Swatch;
  dashed: boolean;
  label?: string;
}
