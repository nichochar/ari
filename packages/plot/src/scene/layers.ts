import type { Material } from 'three';

export const Layer = {
  grid: 0,
  fill: 1,
  region: 2,
  surface: 3,
  stroke: 4,
  point: 5,
  highlight: 6,
} as const;

export type Layer = typeof Layer[keyof typeof Layer];

export function layer(material: Material, dimension: 2 | 3, order: Layer): void {
  if (dimension === 2) {
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
    return;
  }
  if (order === Layer.fill || order === Layer.point || order === Layer.highlight) {
    material.transparent = true;
    material.depthWrite = false;
  }
}
