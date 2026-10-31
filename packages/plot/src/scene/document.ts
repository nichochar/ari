import type { Expr, PlotDocument, Statement } from '../language/types';
import type { Bindings } from './bindings';
import type { Ranges } from './stage2d';
import type { Palette, Swatch } from './theme';

const trigonometric = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2']);

function mentions(expr: Expr, test: (expr: Expr) => boolean): boolean {
  if (test(expr)) return true;
  switch (expr.kind) {
    case 'unary': case 'abs': return mentions(expr.arg, test);
    case 'binary': return mentions(expr.left, test) || mentions(expr.right, test);
    case 'call': return expr.args.some(arg => mentions(arg, test));
    default: return false;
  }
}

function appliesTrigonometry(body: Expr, variable: string): boolean {
  const isVariable = (expr: Expr) => expr.kind === 'name' && expr.name === variable;
  return mentions(body, expr => expr.kind === 'call' && trigonometric.has(expr.name) && expr.args.some(arg => mentions(arg, isVariable)));
}

export function usesAngles(document: PlotDocument): boolean {
  return document.statements.some(statement => {
    if (statement.attributes.hidden) return false;
    if (statement.type === 'polar') return true;
    if (statement.type === 'explicit' && statement.axis === 'y') return appliesTrigonometry(statement.body, 'x');
    if (statement.type === 'function' && statement.plotted && statement.params.length === 1) return appliesTrigonometry(statement.body, statement.params[0]);
    return false;
  });
}

export function drawsInColor(statement: Statement, dimension: 2 | 3): boolean {
  switch (statement.type) {
    case 'explicit': return dimension === 3 || statement.axis !== 'z';
    case 'function': return statement.plotted && statement.params.length === dimension - 1;
    case 'polar': return dimension === 2;
    case 'parametric': {
      const { components, variables } = statement;
      if (variables.length === 1) return dimension === 3 || components.length === 2;
      return dimension === 3 && variables.length === 2 && components.length === 3;
    }
    case 'implicit': return statement.dimension === dimension && (dimension === 2 || statement.comparison === '=');
    case 'point': case 'segment': case 'vector': case 'circle': case 'arc': case 'polygon': return true;
    case 'label': case 'parameter': case 'view': return false;
  }
}

export function assignSwatches(document: PlotDocument, palette: Palette): (Swatch | null)[] {
  return document.statements.map(statement => drawsInColor(statement, document.dimension) ? palette.pick(statement.attributes.color) : null);
}

export function viewRanges(document: PlotDocument, bindings: Bindings): Ranges {
  const ranges: Ranges = {};
  for (const statement of document.statements) {
    if (statement.type !== 'view') continue;
    for (const axis of ['x', 'y', 'z'] as const) {
      const range = statement.ranges[axis];
      if (!range) continue;
      const bounds: [number, number] = [bindings.constant(range.min)(), bindings.constant(range.max)()];
      if (bounds.every(Number.isFinite) && bounds[1] > bounds[0]) ranges[axis] = bounds;
    }
  }
  return ranges;
}
