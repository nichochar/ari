import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivative, evenPowerRoot, scopeOf, statementLatex, toGlsl, toJs, toLatex } from '../src/compile';
import { createContext, parseExpression } from '../src/language/expression';
import { parsePlot } from '../src/language/parse';
import type { Scope } from '../src/compile/types';

const emptyScope: Scope = { parameters: {}, functions: {} };
const parse = (source: string) => parseExpression(source, createContext(['a', 'b', 'c', 'k'], [['f', 1], ['g', 2]]));

const userScope: Scope = {
  parameters: { a: 2, b: -0.5, c: 3, k: 1.5 },
  functions: {
    f: { params: ['x'], body: parse('x^2 + a') },
    g: { params: ['a', 'y'], body: parse('a y + f(y)') },
  },
};

const samples: [number, number][] = [[0.3, 0.7], [1.2, -0.4], [-1.7, 2.1], [2.5, 0.05]];

const battery: [string, (x: number, y: number) => number][] = [
  ['x^2 + y^2 - 1', (x, y) => x ** 2 + y ** 2 - 1],
  ['sin x cos y', (x, y) => Math.sin(x) * Math.cos(y)],
  ['-x^2', x => -(x ** 2)],
  ['2^3^2', () => 512],
  ['e^-x^2', x => Math.exp(-(x ** 2))],
  ['|x| - |y|', (x, y) => Math.abs(x) - Math.abs(y)],
  ['sqrt(x^2 + 1) / (y + 3)', (x, y) => Math.sqrt(x * x + 1) / (y + 3)],
  ['atan2(y, x) + atan x', (x, y) => Math.atan2(y, x) + Math.atan(x)],
  ['ln(x^2 + 1) + log(100) + log2 8 + log10 1000', x => Math.log(x * x + 1) + 2 + 3 + 3],
  ['mod(x, 1) + mod(-x, 1)', (x) => (((x % 1) + 1) % 1) + (((-x % 1) + 1) % 1)],
  ['floor x + ceil y + round x + sign y', (x, y) => Math.floor(x) + Math.ceil(y) + Math.round(x) + Math.sign(y)],
  ['min(x, y, 0) + max(x, y)', (x, y) => Math.min(x, y, 0) + Math.max(x, y)],
  ['sinh x + cosh y + tanh x + exp y', (x, y) => Math.sinh(x) + Math.cosh(y) + Math.tanh(x) + Math.exp(y)],
  ['asin(x / 3) + acos(y / 3) + tan x', (x, y) => Math.asin(x / 3) + Math.acos(y / 3) + Math.tan(x)],
  ['2 pi x + tau - e', x => 2 * Math.PI * x + 2 * Math.PI - Math.E],
  ['a x^3 + b y^-2 + x^c', (x, y) => 2 * x ** 3 - 0.5 * y ** -2 + x ** 3],
  ['f(x) + g(x, y) + f(f(y))', (x, y) => (x * x + 2) + (x * y + y * y + 2) + ((y * y + 2) ** 2 + 2)],
];

function close(actual: number, expected: number, tolerance = 1e-9, message?: string): void {
  if (Number.isNaN(expected)) return assert.ok(Number.isNaN(actual), message);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
}

test('toJs matches Math for a battery of expressions', () => {
  for (const [source, expected] of battery) {
    const compiled = toJs(parse(source), ['x', 'y'], userScope);
    for (const [x, y] of samples) close(compiled.evaluate(x, y), expected(x, y), 1e-9, source);
  }
});

test('toJs handles domain errors without throwing and updates parameters', () => {
  assert.equal(toJs(parse('1 / x'), ['x'], emptyScope).evaluate(0), Infinity);
  assert.ok(Number.isNaN(toJs(parse('sqrt(x) + ln(x)'), ['x'], emptyScope).evaluate(-1)));
  assert.ok(Number.isNaN(toJs(parse('a + x'), ['x'], emptyScope).evaluate(1)));
  const compiled = toJs(parse('a x + f(x)'), ['x'], userScope);
  assert.equal(compiled.evaluate(3), 6 + 11);
  compiled.update({ a: 10 });
  assert.equal(compiled.evaluate(3), 30 + 19);
  assert.equal(userScope.parameters.a, 2);
});

function evaluateGlsl(code: string, uniforms: Record<string, number>, x: number, y: number): number {
  const library = {
    ipow: (base: number, exponent: number) => base ** exponent,
    spow: (base: number, exponent: number) => base ** exponent,
    atan: (first: number, second?: number) => second === undefined ? Math.atan(first) : Math.atan2(first, second),
    log: Math.log, log2: Math.log2, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor,
    ceil: Math.ceil, sign: Math.sign, min: Math.min, max: Math.max, mod: (a: number, b: number) => a - b * Math.floor(a / b),
  };
  const names = [...Object.keys(library), ...Object.keys(uniforms), 'x', 'y'];
  const values = [...Object.values(library), ...Object.values(uniforms), x, y];
  return (new Function(...names, `return ${code};`) as (...args: unknown[]) => number)(...values);
}

test('toGlsl output is plausible GLSL and matches toJs numerically', () => {
  for (const [source] of battery) {
    const glsl = toGlsl(parse(source), ['x', 'y'], userScope);
    const withoutIntegerExponents = glsl.code.replace(/, -?\d+\)/g, ')');
    assert.doesNotMatch(withoutIntegerExponents, /(?<![.\w])\d+(?![.\d])/, `${source}: integer literal in ${glsl.code}`);
    assert.doesNotMatch(glsl.code, /\b(f|g|ln|log10|atan2|round|pi|tau)\(/, source);
    const js = toJs(parse(source), ['x', 'y'], userScope);
    for (const [x, y] of samples) close(evaluateGlsl(glsl.code, glsl.uniforms, x, y), js.evaluate(x, y), 1e-9, `${source} -> ${glsl.code}`);
  }
});

test('toGlsl uses ipow for literal integer exponents, uniforms for parameters and log base 10', () => {
  const glsl = toGlsl(parse('x^2 + y^-3 + a x^k + log(x)'), ['x', 'y'], userScope);
  assert.match(glsl.code, /ipow\(x, 2\)/);
  assert.match(glsl.code, /ipow\(y, -3\)/);
  assert.match(glsl.code, /spow\(x, u_k\)/);
  assert.match(glsl.code, /\(log\(x\) \/ log\(10\.0\)\)/);
  assert.deepEqual(glsl.uniforms, { u_a: 2, u_k: 1.5 });
  assert.match(glsl.prelude, /float ipow\(float b, int n\)/);
  assert.match(glsl.prelude, /float spow\(float b, float e\)/);
  assert.equal(toGlsl(parse('x + 1'), ['x'], emptyScope).prelude, '');
  assert.equal(toGlsl(parse('atan2(y, x)'), ['x', 'y'], emptyScope).code, 'atan(y, x)');
  assert.equal(toGlsl(parse('ln x + 0.25'), ['x'], emptyScope).code, '(log(x) + 0.25)');
  for (const x of [-2.5, -1, 0.5, 3]) {
    const cube = toGlsl(parse('x^3 - x^2'), ['x'], emptyScope);
    close(evaluateGlsl(cube.code, {}, x, 0), x ** 3 - x ** 2);
  }
});

test('toLatex renders readable LaTeX with minimal parentheses', () => {
  const cases: [string, string][] = [
    ['sin(a x)', '\\sin\\left(ax\\right)'],
    ['x^2 + y^2', 'x^{2}+y^{2}'],
    ['(x + 1)^2', '\\left(x+1\\right)^{2}'],
    ['1 / (x + 1)', '\\frac{1}{x+1}'],
    ['sqrt(x) + |x|', '\\sqrt{x}+\\left|x\\right|'],
    ['2 * 3', '2\\cdot 3'],
    ['2 pi theta', '2\\pi\\theta'],
    ['e^x', 'e^{x}'],
    ['-(x + 1)', '-\\left(x+1\\right)'],
    ['x - (y - 1)', 'x-\\left(y-1\\right)'],
    ['x - y z', 'x-yz'],
    ['(x + 1)(x - 1)', '\\left(x+1\\right)\\left(x-1\\right)'],
    ['-x^2', '-x^{2}'],
    ['(-x)^2', '\\left(-x\\right)^{2}'],
    ['2^3^2', '2^{3^{2}}'],
    ['(2^3)^2', '\\left(2^{3}\\right)^{2}'],
    ['atan2(y, x) + floor x', '\\operatorname{atan2}\\left(y, x\\right)+\\left\\lfloor x\\right\\rfloor '],
    ['log2 x + asin x', '\\log_{2}\\left(x\\right)+\\arcsin\\left(x\\right)'],
  ];
  for (const [source, latex] of cases) assert.equal(toLatex(parse(source)), latex, source);
  assert.equal(toLatex(parseExpression('a_max + x1 + kk', createContext(['a_max', 'kk']))), 'a_{\\mathrm{max}}+x_{1}+\\mathrm{kk}');
});

test('statementLatex renders whole rows', () => {
  const document = parsePlot([
    'a = 2',
    'y = sin(a x)',
    'x^2 + y^2 <= 1',
    'f(x) = x^3 for x in [0, 2]',
    'point (1, 2)',
    'label "50% & up" at (0, 0)',
  ].join('\n'));
  assert.deepEqual(document.statements.map(statementLatex), [
    'a=2',
    'y=\\sin\\left(ax\\right)',
    'x^{2}+y^{2}\\le 1',
    'f\\left(x\\right)=x^{3}\\left\\{0\\le x\\le 2\\right\\}',
    '\\left(1, 2\\right)',
    '\\text{label}\\ \\text{"50\\% \\& up"}\\ \\text{at}\\ \\left(0, 0\\right)',
  ]);
});

test('scopeOf evaluates parameters in dependency order with overrides', () => {
  const document = parsePlot(['m = 3h^2 - 3 + f(h)', 'f(x) = x + k', 'k = 10', 'h = 1 in [-2, 2]'].join('\n'));
  assert.deepEqual(document.errors, []);
  const scope = scopeOf(document);
  assert.deepEqual(scope.parameters, { k: 10, h: 1, m: 11 });
  assert.deepEqual(Object.keys(scope.functions), ['f']);
  assert.deepEqual(scopeOf(document, { h: 2, stale: 5 }).parameters, { k: 10, h: 2, m: 21 });
  assert.equal(scopeOf(document, { m: 0 }).parameters.m, 0);
});

test('cycles are reported by the parser and rejected by scopeOf', () => {
  const document = parsePlot('a = b + 1\nb = a\nc = 1\nf(x) = f(x)');
  assert.deepEqual(document.errors.map(error => error.line), [1, 2, 4]);
  assert.deepEqual(scopeOf(document).parameters, { c: 1 });
  const unchecked = { ...document, statements: parsePlot('a = 1').statements.map(statement => ({ ...statement, value: parse('a') })) };
  assert.throws(() => scopeOf(unchecked), /Circular definitions: a/);
});

function centralDifference(source: string, variable: 'x' | 'y', x: number, y: number): number {
  const compiled = toJs(parse(source), ['x', 'y'], userScope);
  const h = 1e-5;
  return variable === 'x'
    ? (compiled.evaluate(x + h, y) - compiled.evaluate(x - h, y)) / (2 * h)
    : (compiled.evaluate(x, y + h) - compiled.evaluate(x, y - h)) / (2 * h);
}

test('derivative matches central finite differences', () => {
  const smooth = [
    'x^2 + y^2 - 1', 'sin x cos y', 'x^3 y - 2x / (y + 3)', 'e^(-x^2) + exp(x y)', 'tan(x / 2) + atan(x y)',
    'asin(x / 3) + acos(y / 3)', 'sinh x + cosh y + tanh(x y)', 'ln(x^2 + 1) + log(y^2 + 2) + log2(x^2 + 3) + log10(4 + y)',
    'sqrt(x^2 + y^2 + 1)', '(x^2 + 1)^(y^2 + 1)', '2^x + x^-2', '|x| + |y - 3|', 'atan2(y, x)', 'min(x, y) + max(x^2, y, 0)',
    'mod(x, 0.7) + mod(3, y + 5)', 'floor x + sign y + round(x + 0.1) + ceil y', 'a x^c + b y^2 + k', 'f(x) + g(x, y) + f(f(y))',
    '-x^2 + (x y)^3',
  ];
  for (const source of smooth) {
    for (const variable of ['x', 'y'] as const) {
      const slope = toJs(derivative(parse(source), variable, userScope), ['x', 'y'], userScope);
      for (const [x, y] of samples) {
        close(slope.evaluate(x, y), centralDifference(source, variable, x, y), 1e-5, `d/d${variable} ${source} at ${x}, ${y}`);
      }
    }
  }
});

test('derivative folds constants to keep results small', () => {
  assert.equal(toLatex(derivative(parse('x^2 + a'), 'x', userScope)), '2x');
  assert.equal(toLatex(derivative(parse('3x + y'), 'x', userScope)), '3');
  assert.equal(toLatex(derivative(parse('sin x'), 'x', userScope)), '\\cos\\left(x\\right)');
  assert.equal(toLatex(derivative(parse('a'), 'x', userScope)), '0');
});

test('evenPowerRoot strips a top-level even power only', () => {
  assert.equal(toLatex(evenPowerRoot(parse('(x^2 + y^2 - 1)^2'))), 'x^{2}+y^{2}-1');
  assert.equal(toLatex(evenPowerRoot(parse('((x - y)^2)^4'))), 'x-y');
  assert.equal(toLatex(evenPowerRoot(parse('(x - y)^3'))), '\\left(x-y\\right)^{3}');
  assert.equal(toLatex(evenPowerRoot(parse('(x - y)^a'))), '\\left(x-y\\right)^{a}');
  assert.equal(toLatex(evenPowerRoot(parse('x^2 + y^2'))), 'x^{2}+y^{2}');
});
