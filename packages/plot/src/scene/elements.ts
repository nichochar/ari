import type { Expr, PlotDocument, Point, Range, Statement } from '../language/types';
import type { ElementContext, Style } from './context';
import { CurveElement, type CurveSource } from './curves';
import type { PlotElement } from './frame';
import { circlePath, PathElement, PointElement, TextElement, VectorElement, type Coordinates } from './geometry';
import { Implicit2DElement } from './implicit2d';
import { Implicit3DElement } from './implicit3d';
import { SurfaceElement, type SurfaceSource } from './surfaces';

type Bounds = () => [number, number];

const fullCircle: [number, number] = [0, 2 * Math.PI];
const surfaceDefault: [number, number] = [-2, 2];

export function buildElements(document: PlotDocument, context: ElementContext): PlotElement[] {
  const elements: PlotElement[] = [];
  document.statements.forEach((statement, index) => {
    if (statement.attributes.hidden) return;
    try {
      const element = build(statement, index, context);
      if (element) elements.push(element);
    } catch {
      return;
    }
  });
  return elements;
}

function build(statement: Statement, index: number, context: ElementContext): PlotElement | null {
  const { bindings, dimension, box } = context;
  const style = (): Style => ({
    statement: index,
    color: context.swatches[index] ?? context.palette.foreground,
    dashed: statement.attributes.dashed ?? false,
    label: statement.attributes.label,
  });
  const bounds = (range: Range | undefined, fallback: [number, number]): Bounds => {
    if (!range) return () => fallback;
    const min = bindings.constant(range.min), max = bindings.constant(range.max);
    return () => [min(), max()];
  };
  const boxRange = (axis: 'x' | 'y' | 'z'): [number, number] => {
    const i = ['x', 'y', 'z'].indexOf(axis);
    return [box.min[i], box.max[i]];
  };
  const coordinates = (point: Point): Coordinates => {
    const parts = point.coords.map(coord => bindings.constant(coord));
    return () => [parts[0]?.() ?? NaN, parts[1]?.() ?? NaN, parts[2]?.() ?? 0];
  };
  const curve = (source: CurveSource) => new CurveElement(source, style(), context);
  const graph = (body: Expr, variable: string, follows: 'x' | 'y', domain: Range | undefined) => {
    const f = bindings.function(body, [variable]);
    return curve({
      follows, domain: bounds(domain, [-Infinity, Infinity]),
      evaluate: follows === 'x' ? t => [t, f(t)] : t => [f(t), t],
    });
  };
  const surface = (source: SurfaceSource) => new SurfaceElement(source, style(), context);
  const height = (body: Expr, axis: 'x' | 'y' | 'z', domains: Record<string, Range>) => {
    const [first, second] = (['x', 'y', 'z'] as const).filter(other => other !== axis);
    const f = bindings.function(body, [first, second]);
    const ranges = [bounds(domains[first], boxRange(first)), bounds(domains[second], boxRange(second))];
    return surface({
      domains: () => [ranges[0](), ranges[1]()],
      evaluate: (u, v) => {
        const value = f(u, v);
        return axis === 'z' ? [u, v, value] : axis === 'y' ? [u, value, v] : [value, u, v];
      },
    });
  };

  switch (statement.type) {
    case 'explicit':
      if (dimension === 3) return height(statement.body, statement.axis, statement.domains);
      if (statement.axis === 'z') return null;
      return statement.axis === 'y'
        ? graph(statement.body, 'x', 'x', statement.domains.x)
        : graph(statement.body, 'y', 'y', statement.domains.y);
    case 'function':
      if (!statement.plotted) return null;
      if (statement.params.length === 1 && dimension === 2) return graph(statement.body, statement.params[0], 'x', statement.domains[statement.params[0]]);
      if (statement.params.length === 2 && dimension === 3) return height(statement.body, 'z', statement.domains);
      return null;
    case 'polar': {
      if (dimension === 3) return null;
      const r = bindings.function(statement.body, ['theta']);
      return curve({
        follows: null, domain: bounds(statement.domains.theta, fullCircle),
        evaluate: t => { const radius = r(t); return [radius * Math.cos(t), radius * Math.sin(t)]; },
      });
    }
    case 'parametric': {
      const { components, variables, domains } = statement;
      if (variables.length === 1) {
        const parts = components.map(component => bindings.function(component, variables));
        if (dimension === 2 && parts.length !== 2) return null;
        return curve({ follows: null, domain: bounds(domains[variables[0]], fullCircle), evaluate: t => parts.map(part => part(t)) });
      }
      if (variables.length === 2 && components.length === 3 && dimension === 3) {
        const parts = components.map(component => bindings.function(component, variables));
        const ranges = variables.map(variable => bounds(domains[variable], surfaceDefault));
        return surface({
          domains: () => [ranges[0](), ranges[1]()],
          evaluate: (u, v) => [parts[0](u, v), parts[1](u, v), parts[2](u, v)],
        });
      }
      return null;
    }
    case 'implicit': {
      const difference = bindings.difference(statement.left, statement.right);
      if (statement.dimension === 2 && dimension === 2) {
        return new Implicit2DElement(bindings.field(difference, ['x', 'y']), statement.comparison, bindings.function(difference, ['x', 'y']), style(), context);
      }
      if (statement.dimension === 3 && dimension === 3 && statement.comparison === '=') {
        return new Implicit3DElement(bindings.field(difference, ['x', 'y', 'z']), style(), context);
      }
      return null;
    }
    case 'point':
      return new PointElement(coordinates(statement.point), style(), context);
    case 'segment': {
      const from = coordinates(statement.from), to = coordinates(statement.to);
      return new PathElement({
        path: () => [from(), to()],
        anchor: () => ({ point: from().map((value, axis) => (value + to()[axis]) / 2), placement: 'beside' }),
      }, style(), context);
    }
    case 'vector': {
      const from = coordinates(statement.from), to = coordinates(statement.to);
      return new VectorElement(() => [from(), to()], style(), context);
    }
    case 'circle': {
      const center = coordinates(statement.center), radius = bindings.constant(statement.radius);
      return new PathElement({
        path: () => circlePath(center(), radius()),
        anchor: () => ({ point: circlePath(center(), radius(), Math.PI / 4, Math.PI / 4)[0], placement: 'beside' }),
      }, style(), context);
    }
    case 'arc': {
      const center = coordinates(statement.center), radius = bindings.constant(statement.radius);
      const from = bindings.constant(statement.from), to = bindings.constant(statement.to);
      return new PathElement({
        path: () => circlePath(center(), radius(), from(), to()),
        anchor: () => {
          const middle = (from() + to()) / 2;
          return { point: circlePath(center(), radius(), middle, middle)[0], placement: 'beside' };
        },
      }, style(), context);
    }
    case 'polygon': {
      const vertices = statement.points.map(coordinates);
      return new PathElement({
        path: () => {
          const points = vertices.map(vertex => vertex());
          return points.length ? [...points, points[0]] : [];
        },
        anchor: () => {
          const points = vertices.map(vertex => vertex());
          return { point: [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length), placement: 'center' };
        },
        fill: true,
      }, style(), context);
    }
    case 'label': {
      const color = statement.attributes.color ? context.palette.pick(statement.attributes.color).css : context.palette.foreground.css;
      return new TextElement(statement.text, coordinates(statement.at), color);
    }
    case 'parameter':
    case 'view':
      return null;
  }
}
