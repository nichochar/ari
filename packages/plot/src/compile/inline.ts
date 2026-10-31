import { isBuiltinFunction } from '../language/expression';
import type { Expr } from '../language/types';
import type { Scope } from './types';

const maxInlineDepth = 64;

export function inlineFunctions(expr: Expr, functions: Scope['functions'], depth = 0): Expr {
  if (expr.kind !== 'call' || isBuiltinFunction(expr.name) || !Object.hasOwn(functions, expr.name)) {
    return mapChildren(expr, child => inlineFunctions(child, functions, depth));
  }
  const { params, body } = functions[expr.name];
  if (params.length !== expr.args.length || depth >= maxInlineDepth) return { kind: 'number', value: NaN };
  const bound = new Map(params.map((param, index) => [param, inlineFunctions(expr.args[index], functions, depth)]));
  return inlineFunctions(substitute(body, bound), functions, depth + 1);
}

function substitute(expr: Expr, bound: ReadonlyMap<string, Expr>): Expr {
  if (expr.kind === 'name') return bound.get(expr.name) ?? expr;
  return mapChildren(expr, child => substitute(child, bound));
}

function mapChildren(expr: Expr, map: (child: Expr) => Expr): Expr {
  switch (expr.kind) {
    case 'unary': return { ...expr, arg: map(expr.arg) };
    case 'abs': return { ...expr, arg: map(expr.arg) };
    case 'binary': return { ...expr, left: map(expr.left), right: map(expr.right) };
    case 'call': return { ...expr, args: expr.args.map(map) };
    default: return expr;
  }
}
