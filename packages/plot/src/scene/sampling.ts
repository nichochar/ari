export type Point = number[];

export interface SampleOptions {
  evaluate(t: number): Point;
  measure(point: Point): Point;
  outside?(measured: Point): number;
  spacing: number;
  breakLength: number;
  minimumDepth?: number;
  maximumDepth?: number;
  tolerance?: number;
  budget?: number;
}

interface Probe { t: number; point: Point; screen: Point | null; }

const bendCosine = Math.cos(5 * Math.PI / 180);
const edgeIterations = 30;
const jumpRatio = 0.8;

const hash = (value: number) => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const finite = (point: Point) => point.every(Number.isFinite);

function distance(a: Point, b: Point): number {
  let squared = 0;
  for (let i = 0; i < a.length; i++) squared += (b[i] - a[i]) ** 2;
  return Math.sqrt(squared);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  let lengthSquared = 0, along = 0;
  for (let i = 0; i < p.length; i++) {
    lengthSquared += (b[i] - a[i]) ** 2;
    along += (p[i] - a[i]) * (b[i] - a[i]);
  }
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, along / lengthSquared)) : 0;
  let squared = 0;
  for (let i = 0; i < p.length; i++) squared += (p[i] - a[i] - t * (b[i] - a[i])) ** 2;
  return Math.sqrt(squared);
}

function bendCos(a: Point, m: Point, b: Point): number {
  let dot = 0, first = 0, second = 0;
  for (let i = 0; i < a.length; i++) {
    const u = m[i] - a[i], v = b[i] - m[i];
    dot += u * v;
    first += u * u;
    second += v * v;
  }
  return first > 0 && second > 0 ? dot / Math.sqrt(first * second) : 1;
}

export function sampleCurve(start: number, end: number, options: SampleOptions): Point[][] {
  const { evaluate, measure, outside, spacing, breakLength } = options;
  const minimumDepth = options.minimumDepth ?? 2;
  const maximumDepth = options.maximumDepth ?? 10;
  const tolerance = options.tolerance ?? 0.25;
  let budget = options.budget ?? 60000;
  const lines: Point[][] = [];
  let line: Point[] = [];

  const probe = (t: number): Probe => {
    budget--;
    const point = evaluate(t);
    return { t, point, screen: finite(point) ? measure(point) : null };
  };
  const split = (a: Probe, b: Probe) => probe(a.t + (b.t - a.t) * (0.4 + 0.2 * hash(a.t * 7.31 + b.t)));
  const finish = () => {
    if (line.length > 1) lines.push(line);
    line = [];
  };
  const emit = (probe: Probe) => {
    if (probe.screen) line.push(probe.point);
    else finish();
  };
  const edge = (inside: Probe, beyond: Probe): Probe => {
    let a = inside, b = beyond;
    for (let i = 0; i < edgeIterations; i++) {
      const m = probe((a.t + b.t) / 2);
      if (m.screen) a = m;
      else b = m;
    }
    return a;
  };

  const refine = (a: Probe, b: Probe, depth: number, parentSpan: number): void => {
    if (!a.screen && !b.screen) return finish();
    if (!a.screen) {
      const e = edge(b, a);
      finish();
      emit(e);
      return refine(e, b, depth, Infinity);
    }
    if (!b.screen) {
      const e = edge(a, b);
      refine(a, e, depth, Infinity);
      return finish();
    }
    const span = distance(a.screen, b.screen);
    const settled = depth >= maximumDepth || budget <= 0;
    if (!settled) {
      const m = split(a, b);
      const hidden = outside && m.screen && (outside(a.screen) & outside(b.screen) & outside(m.screen)) !== 0;
      const rough = !m.screen || distanceToSegment(m.screen, a.screen, b.screen) > tolerance || bendCos(a.screen, m.screen, b.screen) < bendCosine;
      if (!hidden && (depth < minimumDepth || rough)) {
        refine(a, m, depth + 1, span);
        refine(m, b, depth + 1, span);
        return;
      }
    }
    if (settled && span > breakLength && span > jumpRatio * parentSpan) {
      finish();
      emit(b);
      return;
    }
    emit(b);
  };

  const first = Math.floor(start / spacing), last = Math.ceil(end / spacing);
  let previous = probe(start);
  emit(previous);
  for (let k = first; k <= last; k++) {
    const t = Math.min(end, (k + 0.5 + 0.5 * (hash(k) - 0.5)) * spacing);
    if (t <= previous.t) continue;
    const next = probe(t);
    refine(previous, next, 0, Infinity);
    previous = next;
  }
  if (previous.t < end) refine(previous, probe(end), 0, Infinity);
  finish();
  return lines;
}

export interface Rect { minX: number; minY: number; maxX: number; maxY: number; }

export function clipSegment(a: Point, b: Point, rect: Rect): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const edges: [number, number][] = [[-dx, a[0] - rect.minX], [dx, rect.maxX - a[0]], [-dy, a[1] - rect.minY], [dy, rect.maxY - a[1]]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0, t1];
}
