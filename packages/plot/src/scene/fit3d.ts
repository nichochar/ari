import type { PlotDocument, Point, Range, Statement } from '../language/types';
import type { Box } from './axes3d';
import type { Bindings, Evaluate } from './bindings';
import type { Ranges } from './stage2d';
import { decimalStep } from './ticks';

type Interval = [number, number];

const axisNames = ['x', 'y', 'z'] as const;
const fallback: Interval = [-3, 3];
const search: Interval = [-8, 8];
const searchCells = 25;
const surfaceSamples = 32;
const curveSamples = 256;
const fullCircle: Interval = [0, 2 * Math.PI];
const surfaceDefault: Interval = [-2, 2];

function geometryPoints(statement: Statement): Point[] {
  switch (statement.type) {
    case 'point': return [statement.point];
    case 'segment': case 'vector': return [statement.from, statement.to];
    case 'polygon': return statement.points;
    default: return [];
  }
}

class Extents {
  readonly intervals: (Interval | null)[] = [null, null, null];

  add(axis: number, interval: Interval | null): void {
    if (!interval) return;
    const current = this.intervals[axis];
    this.intervals[axis] = current ? [Math.min(current[0], interval[0]), Math.max(current[1], interval[1])] : interval;
  }
}

function spread(values: number[]): Interval | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const full: Interval = [finite[0], finite[finite.length - 1]];
  const quantile = (q: number) => finite[Math.round(q * (finite.length - 1))];
  const core: Interval = [quantile(0.02), quantile(0.98)];
  return full[1] - full[0] > 100 * Math.max(core[1] - core[0], 1e-9) ? core : full;
}

function padded(interval: Interval | null, fraction: number): Interval | null {
  if (!interval) return null;
  const span = interval[1] - interval[0];
  const pad = span > 0 ? span * fraction : Math.max(1, Math.abs(interval[0]) * fraction);
  const step = decimalStep((span + 2 * pad) / 20).major;
  const snap = (units: number) => Number((units * step).toPrecision(12));
  return [snap(Math.floor((interval[0] - pad) / step + 1e-9)), snap(Math.ceil((interval[1] + pad) / step - 1e-9))];
}

function grid(ranges: Interval[], cells: number, visit: (point: number[]) => void): void {
  for (let i = 0; i <= cells; i++) {
    for (let j = 0; j <= cells; j++) {
      const u = ranges[0][0] + (ranges[0][1] - ranges[0][0]) * i / cells;
      const v = ranges[1][0] + (ranges[1][1] - ranges[1][0]) * j / cells;
      visit([u, v]);
    }
  }
}

function signChanges(field: Evaluate, ranges: Interval[]): Interval[] | null {
  const n = searchCells + 1;
  const coordinate = (axis: number, index: number) => ranges[axis][0] + (ranges[axis][1] - ranges[axis][0]) * index / searchCells;
  const values = new Float64Array(n * n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) values[(i * n + j) * n + k] = field(coordinate(0, i), coordinate(1, j), coordinate(2, k));
    }
  }
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  const include = (i: number, j: number, k: number) => {
    [i, j, k].forEach((index, axis) => {
      low[axis] = Math.min(low[axis], coordinate(axis, index));
      high[axis] = Math.max(high[axis], coordinate(axis, index));
    });
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const value = values[(i * n + j) * n + k];
        const neighbours: [number, number, number][] = [[i + 1, j, k], [i, j + 1, k], [i, j, k + 1]];
        for (const [a, b, c] of neighbours) {
          if (a >= n || b >= n || c >= n || !(value * values[(a * n + b) * n + c] < 0)) continue;
          include(i, j, k);
          include(a, b, c);
        }
      }
    }
  }
  return low[0] <= high[0] ? low.map((value, axis) => [value, high[axis]]) : null;
}

function implicitExtent(field: Evaluate, ranges: Ranges): Interval[] | null {
  const initial = axisNames.map(name => ranges[name] ?? search);
  const coarse = signChanges(field, initial);
  if (!coarse) return null;
  const refined = coarse.map(([min, max], axis): Interval => {
    if (ranges[axisNames[axis]]) return initial[axis];
    const cell = (initial[axis][1] - initial[axis][0]) / searchCells;
    return [min - cell, max + cell];
  });
  return signChanges(field, refined) ?? coarse;
}

export function fitBox(document: PlotDocument, bindings: Bindings, ranges: Ranges): Box {
  const bounds = (range: Range | undefined, otherwise: Interval): Interval => {
    if (!range) return otherwise;
    const interval: Interval = [bindings.constant(range.min)(), bindings.constant(range.max)()];
    return interval.every(Number.isFinite) && interval[1] > interval[0] ? interval : otherwise;
  };
  const domains = new Extents(), samples = new Extents(), implicit = new Extents();
  const heights: { axis: number; others: number[]; evaluate: Evaluate; domains: (Interval | null)[] }[] = [];

  for (const statement of document.statements) {
    if (statement.type === 'explicit' || statement.type === 'function' && statement.plotted && statement.params.length === 2) {
      const axis = statement.type === 'explicit' ? axisNames.indexOf(statement.axis) : 2;
      const others = [0, 1, 2].filter(other => other !== axis);
      const variables = statement.type === 'function' ? statement.params : others.map(other => axisNames[other]);
      const own = variables.map(variable => statement.domains[variable] ? bounds(statement.domains[variable], fallback) : null);
      own.forEach((interval, index) => domains.add(others[index], interval));
      heights.push({ axis, others, evaluate: bindings.function(statement.body, variables), domains: own });
    } else if (statement.type === 'parametric') {
      const parts = statement.components.map(component => bindings.function(component, statement.variables));
      const points: number[][] = [];
      if (statement.variables.length === 1) {
        const [start, end] = bounds(statement.domains[statement.variables[0]], fullCircle);
        for (let i = 0; i <= curveSamples; i++) points.push(parts.map(part => part(start + (end - start) * i / curveSamples)));
      } else if (statement.variables.length === 2) {
        grid(statement.variables.map(variable => bounds(statement.domains[variable], surfaceDefault)), surfaceSamples, point => points.push(parts.map(part => part(...point))));
      }
      [0, 1, 2].forEach(axis => samples.add(axis, spread(points.map(point => point[axis] ?? 0))));
    } else if (geometryPoints(statement).length) {
      const points = geometryPoints(statement).map(point => point.coords.map(coord => bindings.constant(coord)()));
      [0, 1, 2].forEach(axis => samples.add(axis, spread(points.map(point => point[axis] ?? 0))));
    } else if (statement.type === 'implicit' && statement.dimension === 3 && statement.comparison === '=') {
      const extent = implicitExtent(bindings.function(bindings.difference(statement.left, statement.right), ['x', 'y', 'z']), ranges);
      extent?.forEach((interval, axis) => implicit.add(axis, padded(interval, 0.15)));
    }
  }

  const resolve = (axis: number, extra: Interval | null): Interval => {
    const view = ranges[axisNames[axis]];
    if (view) return view;
    const combined = new Extents();
    combined.add(0, domains.intervals[axis]);
    combined.add(0, padded(samples.intervals[axis], 0.1));
    combined.add(0, implicit.intervals[axis]);
    combined.add(0, padded(extra, 0.1));
    return combined.intervals[0] ?? fallback;
  };
  const provisional = [0, 1, 2].map(axis => resolve(axis, null));
  const heightValues: number[][] = [[], [], []];
  for (const { axis, others, evaluate, domains: own } of heights) {
    grid(others.map((other, index) => own[index] ?? provisional[other]), surfaceSamples, ([u, v]) => heightValues[axis].push(evaluate(u, v)));
  }
  const final = [0, 1, 2].map(axis => resolve(axis, spread(heightValues[axis])));
  return { min: [final[0][0], final[1][0], final[2][0]], max: [final[0][1], final[1][1], final[2][1]] };
}
