import { references } from '../language/expression';
import type { Expr } from '../language/types';
import { inlineFunctions } from './inline';
import type { Scope } from './types';

export function derivative(expr: Expr, variable: string, scope: Scope): Expr {
  return differentiate(inlineFunctions(expr, scope.functions), variable);
}

export function evenPowerRoot(expr: Expr): Expr {
  if (expr.kind !== 'binary' || expr.op !== '^') return expr;
  const exponent = numericValue(expr.right);
  const isEvenPower = exponent !== undefined && exponent >= 2 && Number.isInteger(exponent / 2);
  return isEvenPower ? evenPowerRoot(expr.left) : expr;
}

function differentiate(expr: Expr, variable: string): Expr {
  const d = (inner: Expr) => differentiate(inner, variable);
  switch (expr.kind) {
    case 'number': return number(0);
    case 'name': return number(expr.name === variable ? 1 : 0);
    case 'unary': return negate(d(expr.arg));
    case 'abs': return multiply(call('sign', expr.arg), d(expr.arg));
    case 'call': return callDerivative(expr.name, expr.args, variable);
    case 'binary': {
      const { left, right } = expr;
      switch (expr.op) {
        case '+': return add(d(left), d(right));
        case '-': return subtract(d(left), d(right));
        case '*': return add(multiply(d(left), right), multiply(left, d(right)));
        case '/': return divide(subtract(multiply(d(left), right), multiply(left, d(right))), power(right, number(2)));
        case '^': return powerDerivative(left, right, variable);
      }
    }
  }
}

function powerDerivative(base: Expr, exponent: Expr, variable: string): Expr {
  const baseSlope = differentiate(base, variable);
  if (!references(exponent).names.has(variable)) {
    return multiply(multiply(exponent, power(base, subtract(exponent, number(1)))), baseSlope);
  }
  const exponentSlope = differentiate(exponent, variable);
  const logarithmic = add(multiply(exponentSlope, call('ln', base)), divide(multiply(exponent, baseSlope), base));
  return multiply(power(base, exponent), logarithmic);
}

function callDerivative(name: string, args: readonly Expr[], variable: string): Expr {
  const [u, w] = args;
  const d = (inner: Expr) => differentiate(inner, variable);
  switch (name) {
    case 'atan2': return divide(subtract(multiply(w, d(u)), multiply(u, d(w))), add(power(w, number(2)), power(u, number(2))));
    case 'mod': return subtract(d(u), multiply(d(w), call('floor', divide(u, w))));
    case 'min':
    case 'max': return extremumDerivative(name, args, variable);
    default: return multiply(outerDerivative(name, u), d(u));
  }
}

function extremumDerivative(name: 'min' | 'max', args: readonly Expr[], variable: string): Expr {
  const [first, second, ...rest] = args;
  if (rest.length > 0) return differentiate(call(name, call(name, first, second), ...rest), variable);
  const difference = name === 'min' ? subtract(second, first) : subtract(first, second);
  const firstWeight = multiply(number(0.5), add(number(1), call('sign', difference)));
  const slope = (inner: Expr) => differentiate(inner, variable);
  return add(multiply(firstWeight, slope(first)), multiply(subtract(number(1), firstWeight), slope(second)));
}

function outerDerivative(name: string, u: Expr): Expr {
  const square = power(u, number(2));
  switch (name) {
    case 'sin': return call('cos', u);
    case 'cos': return negate(call('sin', u));
    case 'tan': return divide(number(1), power(call('cos', u), number(2)));
    case 'asin': return divide(number(1), call('sqrt', subtract(number(1), square)));
    case 'acos': return negate(divide(number(1), call('sqrt', subtract(number(1), square))));
    case 'atan': return divide(number(1), add(number(1), square));
    case 'sinh': return call('cosh', u);
    case 'cosh': return call('sinh', u);
    case 'tanh': return subtract(number(1), power(call('tanh', u), number(2)));
    case 'exp': return call('exp', u);
    case 'ln': return divide(number(1), u);
    case 'log':
    case 'log10': return divide(number(1), multiply(u, number(Math.LN10)));
    case 'log2': return divide(number(1), multiply(u, number(Math.LN2)));
    case 'sqrt': return divide(number(1), multiply(number(2), call('sqrt', u)));
    case 'abs': return call('sign', u);
    case 'sign':
    case 'floor':
    case 'ceil':
    case 'round': return number(0);
    default: return number(NaN);
  }
}

function numericValue(expr: Expr): number | undefined {
  if (expr.kind === 'number') return expr.value;
  if (expr.kind === 'unary' && expr.arg.kind === 'number') return -expr.arg.value;
  return undefined;
}

function number(value: number): Expr {
  return value < 0 ? { kind: 'unary', op: '-', arg: { kind: 'number', value: -value } } : { kind: 'number', value };
}

function call(name: string, ...args: Expr[]): Expr {
  return { kind: 'call', name, args };
}

function negate(arg: Expr): Expr {
  const value = numericValue(arg);
  if (value !== undefined) return number(-value);
  return arg.kind === 'unary' ? arg.arg : { kind: 'unary', op: '-', arg };
}

function add(left: Expr, right: Expr): Expr {
  const [a, b] = [numericValue(left), numericValue(right)];
  if (a !== undefined && b !== undefined) return number(a + b);
  if (a === 0) return right;
  if (b === 0) return left;
  return { kind: 'binary', op: '+', left, right };
}

function subtract(left: Expr, right: Expr): Expr {
  const [a, b] = [numericValue(left), numericValue(right)];
  if (a !== undefined && b !== undefined) return number(a - b);
  if (b === 0) return left;
  if (a === 0) return negate(right);
  return { kind: 'binary', op: '-', left, right };
}

function multiply(left: Expr, right: Expr): Expr {
  const [a, b] = [numericValue(left), numericValue(right)];
  if (a !== undefined && b !== undefined) return number(a * b);
  if (a === 0 || b === 0) return number(0);
  if (a === 1) return right;
  if (b === 1) return left;
  if (a === -1) return negate(right);
  if (b === -1) return negate(left);
  return { kind: 'binary', op: '*', left, right };
}

function divide(left: Expr, right: Expr): Expr {
  const [a, b] = [numericValue(left), numericValue(right)];
  if (a !== undefined && b !== undefined && b !== 0) return number(a / b);
  if (a === 0) return number(0);
  if (b === 1) return left;
  return { kind: 'binary', op: '/', left, right };
}

function power(base: Expr, exponent: Expr): Expr {
  const [a, b] = [numericValue(base), numericValue(exponent)];
  if (b === 0) return number(1);
  if (b === 1) return base;
  if (a !== undefined && b !== undefined) return number(a ** b);
  return { kind: 'binary', op: '^', left: base, right: exponent };
}
