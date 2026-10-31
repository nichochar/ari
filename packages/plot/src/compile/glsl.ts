import { builtinConstants, type Expr } from '../language/types';
import { inlineFunctions } from './inline';
import type { GlslExpression, Scope } from './types';

type Helper = 'ipow' | 'spow';

interface Emitter {
  variables: ReadonlySet<string>;
  parameters: Record<string, number>;
  uniforms: Record<string, number>;
  helpers: Set<Helper>;
}

const maxIntegerPower = 64;

const helperSource: Record<Helper, string> = {
  ipow: `float ipow(float b, int n) {
  float r = 1.0;
  for (int i = 0; i < ${maxIntegerPower}; i++) {
    if (i >= abs(n)) break;
    r *= b;
  }
  return n < 0 ? 1.0 / r : r;
}`,
  spow: `float spow(float b, float e) {
  if (b >= 0.0 || e != floor(e)) return pow(b, e);
  float r = pow(-b, e);
  return mod(e, 2.0) == 0.0 ? r : -r;
}`,
};

const sameName = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log2', 'sqrt', 'abs', 'floor', 'ceil',
  'sign', 'mod'];

const renamed = new Map([['ln', 'log'], ['atan2', 'atan']]);

export function toGlsl(expr: Expr, variables: string[], scope: Scope): GlslExpression {
  const emitter: Emitter = { variables: new Set(variables), parameters: scope.parameters, uniforms: {}, helpers: new Set() };
  const code = emit(inlineFunctions(expr, scope.functions), emitter);
  const prelude = (['ipow', 'spow'] as const).filter(helper => emitter.helpers.has(helper)).map(helper => helperSource[helper]).join('\n');
  return { code, uniforms: emitter.uniforms, prelude };
}

function emit(expr: Expr, emitter: Emitter): string {
  switch (expr.kind) {
    case 'number': return floatLiteral(expr.value);
    case 'name': return name(expr.name, emitter);
    case 'unary': return `(-${emit(expr.arg, emitter)})`;
    case 'abs': return `abs(${emit(expr.arg, emitter)})`;
    case 'binary': return expr.op === '^'
      ? power(expr.left, expr.right, emitter)
      : `(${emit(expr.left, emitter)} ${expr.op} ${emit(expr.right, emitter)})`;
    case 'call': return call(expr.name, expr.args.map(arg => emit(arg, emitter)));
  }
}

function name(variable: string, emitter: Emitter): string {
  if (emitter.variables.has(variable)) return variable;
  if (Object.hasOwn(builtinConstants, variable)) return floatLiteral(builtinConstants[variable]);
  const uniform = `u_${variable}`;
  emitter.uniforms[uniform] = Object.hasOwn(emitter.parameters, variable) ? emitter.parameters[variable] : NaN;
  return uniform;
}

function power(base: Expr, exponent: Expr, emitter: Emitter): string {
  const integer = integerValue(exponent);
  if (integer !== undefined && Math.abs(integer) <= maxIntegerPower) {
    emitter.helpers.add('ipow');
    return `ipow(${emit(base, emitter)}, ${integer})`;
  }
  emitter.helpers.add('spow');
  return `spow(${emit(base, emitter)}, ${emit(exponent, emitter)})`;
}

function integerValue(expr: Expr): number | undefined {
  if (expr.kind === 'number') return Number.isInteger(expr.value) ? expr.value : undefined;
  if (expr.kind === 'unary' && expr.arg.kind === 'number' && Number.isInteger(expr.arg.value)) return -expr.arg.value;
  return undefined;
}

function call(functionName: string, args: string[]): string {
  if (sameName.includes(functionName)) return `${functionName}(${args.join(', ')})`;
  const target = renamed.get(functionName);
  if (target) return `${target}(${args.join(', ')})`;
  if (functionName === 'log' || functionName === 'log10') return `(log(${args[0]}) / log(10.0))`;
  if (functionName === 'round') return `floor(${args[0]} + 0.5)`;
  if (functionName === 'min' || functionName === 'max') return args.reduce((left, right) => `${functionName}(${left}, ${right})`);
  return '(0.0 / 0.0)';
}

function floatLiteral(value: number): string {
  if (Number.isNaN(value)) return '(0.0 / 0.0)';
  if (value < 0 || Object.is(value, -0)) return `(-${floatLiteral(-value)})`;
  if (value === Infinity) return '(1.0 / 0.0)';
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}
