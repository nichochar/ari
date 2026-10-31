import { builtinConstants, type Expr } from '../language/types';
import { inlineFunctions } from './inline';
import type { Compiled, Scope } from './types';

type Factory = (parameters: Record<string, number>, mod: typeof floorMod) => (...values: number[]) => number;

const jsFunctions = new Map([
  ['sin', 'Math.sin'], ['cos', 'Math.cos'], ['tan', 'Math.tan'], ['asin', 'Math.asin'], ['acos', 'Math.acos'], ['atan', 'Math.atan'],
  ['atan2', 'Math.atan2'], ['sinh', 'Math.sinh'], ['cosh', 'Math.cosh'], ['tanh', 'Math.tanh'], ['exp', 'Math.exp'],
  ['ln', 'Math.log'], ['log', 'Math.log10'], ['log2', 'Math.log2'], ['log10', 'Math.log10'], ['sqrt', 'Math.sqrt'],
  ['abs', 'Math.abs'], ['floor', 'Math.floor'], ['ceil', 'Math.ceil'], ['round', 'Math.round'], ['sign', 'Math.sign'],
  ['min', 'Math.min'], ['max', 'Math.max'], ['mod', 'mod'],
]);

function floorMod(dividend: number, divisor: number): number {
  return dividend - divisor * Math.floor(dividend / divisor);
}

export function toJs(expr: Expr, variables: string[], scope: Scope): Compiled {
  const parameters = Object.assign(Object.create(null) as Record<string, number>, scope.parameters);
  const args = variables.map((_, index) => `v${index}`);
  const code = emit(inlineFunctions(expr, scope.functions), new Map(variables.map((name, index) => [name, args[index]])));
  const factory = new Function('p', 'mod', `return (${args.join(', ')}) => ${code};`) as Factory;
  return {
    variables,
    evaluate: factory(parameters, floorMod),
    update: next => { Object.assign(parameters, next); },
  };
}

function emit(expr: Expr, variables: ReadonlyMap<string, string>): string {
  switch (expr.kind) {
    case 'number': return String(expr.value);
    case 'name': return variables.get(expr.name) ?? constant(expr.name) ?? `p[${JSON.stringify(expr.name)}]`;
    case 'unary': return `(- ${emit(expr.arg, variables)})`;
    case 'abs': return `Math.abs(${emit(expr.arg, variables)})`;
    case 'binary': {
      const left = emit(expr.left, variables);
      const right = emit(expr.right, variables);
      return expr.op === '^' ? `Math.pow(${left}, ${right})` : `(${left} ${expr.op} ${right})`;
    }
    case 'call': {
      const name = jsFunctions.get(expr.name);
      return name ? `${name}(${expr.args.map(arg => emit(arg, variables)).join(', ')})` : 'NaN';
    }
  }
}

function constant(name: string): string | undefined {
  return Object.hasOwn(builtinConstants, name) ? String(builtinConstants[name]) : undefined;
}
