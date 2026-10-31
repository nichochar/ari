import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, parseExpression } from '../src/language/expression';
import { defaultDomain, parsePlot } from '../src/language/parse';
import { tokenize } from '../src/language/tokenize';
import type { Expr, Statement } from '../src/language/types';

function show(expr: Expr): string {
  switch (expr.kind) {
    case 'number': return String(expr.value);
    case 'name': return expr.name;
    case 'unary': return `(-${show(expr.arg)})`;
    case 'abs': return `|${show(expr.arg)}|`;
    case 'binary': return `(${show(expr.left)}${expr.op}${show(expr.right)})`;
    case 'call': return `${expr.name}(${expr.args.map(show).join(',')})`;
  }
}

const shown = (source: string, parameters: string[] = ['a', 'b'], functions: [string, number][] = []) =>
  show(parseExpression(source, createContext(parameters, functions)));

function only(source: string): Statement {
  const document = parsePlot(source);
  assert.deepEqual(document.errors, []);
  assert.equal(document.statements.length, 1);
  return document.statements[0];
}

test('tokenizer reads numbers, names, symbols, strings, colors and unicode', () => {
  assert.deepEqual(tokenize('2x1 <= 3.5 # note').map(token => [token.kind, token.text]), [
    ['number', '2'], ['name', 'x1'], ['symbol', '<='], ['number', '3.5'],
  ]);
  assert.deepEqual(tokenize('π θ ≤ ≥ √ a_max').map(token => token.text), ['pi', 'theta', '<=', '>=', 'sqrt', 'a_max']);
  assert.deepEqual(tokenize('{ label: "a # b", color: #FF8800 }').map(token => [token.kind, token.text]), [
    ['symbol', '{'], ['name', 'label'], ['symbol', ':'], ['string', 'a # b'], ['symbol', ','],
    ['name', 'color'], ['symbol', ':'], ['color', '#ff8800'], ['symbol', '}'],
  ]);
  assert.throws(() => tokenize('x @ 2'), /Unexpected character "@"/);
  assert.throws(() => tokenize('label "open'), /closing quote/);
});

test('operators follow precedence, right-associative powers and loose unary minus', () => {
  assert.equal(shown('1 + 2 * 3 ^ 2'), '(1+(2*(3^2)))');
  assert.equal(shown('2^3^2'), '(2^(3^2))');
  assert.equal(shown('-x^2'), '(-(x^2))');
  assert.equal(shown('1 - 2 - 3'), '((1-2)-3)');
  assert.equal(shown('8 / 4 / 2'), '((8/4)/2)');
  assert.equal(shown('e^-x^2'), '(e^(-(x^2)))');
  assert.equal(shown('-2x'), '((-2)*x)');
});

test('implicit multiplication', () => {
  assert.equal(shown('2x'), '(2*x)');
  assert.equal(shown('a x'), '(a*x)');
  assert.equal(shown('x y'), '(x*y)');
  assert.equal(shown('2 sin x'), '(2*sin(x))');
  assert.equal(shown('(x+1)(x-1)'), '((x+1)*(x-1))');
  assert.equal(shown('a (x - b)'), '(a*(x-b))');
  assert.equal(shown('2|x|'), '(2*|x|)');
});

test('multi-letter names split into defined names only when undefined themselves', () => {
  assert.equal(shown('ab'), '(a*b)');
  assert.equal(shown('ab', ['a', 'b', 'ab']), 'ab');
  assert.equal(shown('sinx'), 'sin(x)');
  assert.equal(shown('2pix'), '((2*pi)*x)');
  assert.equal(shown('qz'), 'qz');
  assert.equal(shown('a_max x1', ['a_max']), '(a_max*x1)');
});

test('function application with and without parentheses', () => {
  assert.equal(shown('sin(x)'), 'sin(x)');
  assert.equal(shown('sin x'), 'sin(x)');
  assert.equal(shown('sin 2x'), 'sin((2*x))');
  assert.equal(shown('sin x^2'), 'sin((x^2))');
  assert.equal(shown('sin x + 1'), '(sin(x)+1)');
  assert.equal(shown('sin x cos x'), '(sin(x)*cos(x))');
  assert.equal(shown('sin x / 2'), '(sin(x)/2)');
  assert.equal(shown('sin(x)^2'), '(sin(x)^2)');
  assert.equal(shown('√x'), 'sqrt(x)');
  assert.equal(shown('atan2(y, x)'), 'atan2(y,x)');
  assert.equal(shown('max(1, 2, x)'), 'max(1,2,x)');
  assert.equal(shown('f(a) + f a', [], [['f', 1]]), '(f(a)+f(a))');
  assert.throws(() => shown('atan2(y)'), /atan2 takes 2 arguments/);
  assert.throws(() => shown('sin'), /sin needs an argument/);
});

test('absolute values, unicode and constants', () => {
  assert.equal(shown('|x|'), '|x|');
  assert.equal(shown('|x| + |y|'), '(|x|+|y|)');
  assert.equal(shown('||x| - 1|'), '|(|x|-1)|');
  assert.equal(shown('2π θ'), '((2*pi)*theta)');
  assert.throws(() => shown('(1, 2) + x'), /tuple/);
});

test('every equation form in the table is classified', () => {
  const cases: [string, Partial<Record<string, unknown>>][] = [
    ['y = x^2 - 2', { type: 'explicit', axis: 'y' }],
    ['x = y^2', { type: 'explicit', axis: 'x' }],
    ['f(x) = x^3 - x', { type: 'function', name: 'f', plotted: true }],
    ['g(t) = t^2', { type: 'function', name: 'g', plotted: false }],
    ['r = 1 + cos(theta)', { type: 'polar' }],
    ['x^2 + y^2 = 1', { type: 'implicit', comparison: '=', dimension: 2 }],
    ['y < x^2', { type: 'implicit', comparison: '<' }],
    ['y >= x', { type: 'implicit', comparison: '>=' }],
    ['y ≤ x', { type: 'implicit', comparison: '<=' }],
    ['z = x^2 - y^2', { type: 'explicit', axis: 'z' }],
    ['x^2 + y^2 + z^2 = 1', { type: 'implicit', dimension: 3 }],
    ['(cos t, sin t)', { type: 'parametric', variables: ['t'] }],
    ['(cos t, sin t, t / 4)', { type: 'parametric', variables: ['t'] }],
    ['(v, u, u v)', { type: 'parametric', variables: ['u', 'v'] }],
    ['x = 2', { type: 'explicit', axis: 'x' }],
    ['y = 3', { type: 'explicit', axis: 'y' }],
    ['z = 0', { type: 'explicit', axis: 'z' }],
    ['x = x^2 + y', { type: 'implicit' }],
  ];
  for (const [source, expected] of cases) {
    const statement = only(source);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(Reflect.get(statement, key), value, `${source}: ${key}`);
  }
});

test('documents become 3D through z, three-component points and surfaces', () => {
  assert.equal(parsePlot('y = x').dimension, 2);
  assert.equal(parsePlot('z = x y').dimension, 3);
  assert.equal(parsePlot('point (1, 2, 3)').dimension, 3);
  assert.equal(parsePlot('(u, v, u v)').dimension, 3);
  assert.equal(parsePlot('view z [0, 1]').dimension, 3);
  const mixed = parsePlot('x^2 + y^2 = 1\nz = 0');
  assert.equal(mixed.statements[0].type === 'implicit' && mixed.statements[0].dimension, 3);
});

test('domains and parameter sliders', () => {
  const explicit = only('y = sqrt(x) for x in [0, 9]');
  assert.ok(explicit.type === 'explicit');
  assert.equal(show(explicit.domains.x.max), '9');
  const surface = only('(u, v, sin(u) cos(v)) for u in [-pi, pi], v in [-pi, pi]');
  assert.ok(surface.type === 'parametric');
  assert.deepEqual(Object.keys(surface.domains), ['u', 'v']);
  const slider = only('n = 3 in [1, 10] step 1');
  assert.ok(slider.type === 'parameter' && slider.range && slider.step);
  assert.equal(show(slider.range.max), '10');
  const plain = only('a = 2');
  assert.ok(plain.type === 'parameter');
  assert.equal('range' in plain, false);
  assert.deepEqual(defaultDomain('t'), { min: { kind: 'number', value: 0 }, max: { kind: 'number', value: 2 * Math.PI } });
  assert.deepEqual(defaultDomain('theta'), defaultDomain('t'));
  assert.deepEqual(defaultDomain('u'), { min: { kind: 'number', value: -2 }, max: { kind: 'number', value: 2 } });
  assert.equal(defaultDomain('x'), undefined);
});

test('geometry statements', () => {
  const document = parsePlot([
    'a = 1',
    'point (cos a, sin a, 0)',
    'segment (0, 0, 0) to (1, 1, 1)',
    'vector (1, 2, 0)',
    'vector (1, 1, 0) to (3, 2, 0)',
    'circle (0, 0) radius 1',
    'arc (0, 0) radius 0.4 from 0 to a',
    'polygon (0, 0) (2, 0) (1, 1.5)',
    'label "unit circle" at (1.1, 1.1)',
    'view x [-2, 2] y [-1, 3]',
    '(1, 2)',
  ].join('\n'));
  assert.deepEqual(document.errors, []);
  assert.deepEqual(document.statements.map(statement => statement.type),
    ['parameter', 'point', 'segment', 'vector', 'vector', 'circle', 'arc', 'polygon', 'label', 'view', 'point']);
  const vector = document.statements[3];
  assert.ok(vector.type === 'vector');
  assert.deepEqual(vector.from.coords.map(show), ['0', '0', '0']);
  const label = document.statements[8];
  assert.ok(label.type === 'label' && label.text === 'unit circle');
  const view = document.statements[9];
  assert.ok(view.type === 'view' && view.ranges.x && view.ranges.y && !view.ranges.z);
});

test('attributes and comments', () => {
  const statement = only('y = sin x { label: "sine", color: blue, dashed, hidden } # trailing');
  assert.deepEqual(statement.attributes, { label: 'sine', color: 'blue', dashed: true, hidden: true });
  assert.deepEqual(only('y = x {color: #A0B1C2}').attributes, { color: '#a0b1c2' });
  assert.deepEqual(parsePlot('# only a comment\n\n   ').statements, []);
  assert.equal(only('  y = x  # c').source, 'y = x  # c');
});

test('every LANGUAGE.md example block parses without errors', () => {
  const language = readFileSync(new URL('../LANGUAGE.md', import.meta.url), 'utf8');
  const blocks = [...language.matchAll(/```plot\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.ok(blocks.length >= 8);
  for (const block of blocks) {
    const definesAngle = /^a = /m.test(block);
    const usesAngle = /\ba\b/.test(block);
    const source = usesAngle && !definesAngle ? `${block}\na = 1` : block;
    assert.deepEqual(parsePlot(source).errors, [], block);
  }
});

test('bad lines are reported with line numbers while the rest still parses', () => {
  const document = parsePlot([
    'y = x^2',
    'y = (x + 1',
    'y = q x',
    'a = 1',
    'a = 2',
    'theta = 3',
    'b = x^2',
    'y = x { bold }',
    'y = x^2 for t in [0, 1]',
    'polygon (0, 0) (1, 1)',
    'segment (0, 0) to (1, 1, 1)',
    'c = d + 1',
    'd = c',
    'y = sin x',
    '(t, u, v)',
    'x < y + z',
  ].join('\n'));
  assert.deepEqual(document.errors.map(error => error.line), [2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16]);
  assert.match(document.errors[0].message, /Expected "\)" at the end of the line/);
  assert.match(document.errors[1].message, /Unknown name "q"/);
  assert.match(document.errors[2].message, /already defined on line 4/);
  assert.match(document.errors[3].message, /reserved/);
  assert.match(document.errors[4].message, /b\(x\) = \.\.\./);
  assert.match(document.errors[5].message, /Unknown attribute "bold"/);
  assert.match(document.errors[6].message, /"t" is not a variable here; use x or z/);
  assert.match(document.errors[9].message, /"c" is defined in terms of itself/);
  assert.match(document.errors[12].message, /2D/);
  assert.deepEqual(document.statements.map(statement => statement.line), [1, 4, 14]);
});

test('t, u and v are parametric variables only when the block does not define them', () => {
  const curve = only('(cos t, sin t)');
  assert.ok(curve.type === 'parametric');
  assert.deepEqual(curve.variables, ['t']);
  const moving = parsePlot('(cos t, sin t)\nt = 1 in [0, 6]');
  assert.deepEqual(moving.errors, []);
  assert.deepEqual(moving.statements.map(statement => statement.type), ['point', 'parameter']);
  const shifted = parsePlot('v = 0 in [-3, 3]\nh = 1\ny = (x - h)^2 + v\nu(s) = s + v');
  assert.deepEqual(shifted.errors, []);
  assert.deepEqual(shifted.statements.map(statement => statement.type), ['parameter', 'parameter', 'explicit', 'function']);
  const surface = parsePlot('(u, v, uv)\na = 1');
  assert.ok(surface.statements[0].type === 'parametric');
  assert.deepEqual(surface.statements[0].variables, ['u', 'v']);
  assert.match(parsePlot('y = t').errors[0].message, /Unknown name "t"/);
  assert.equal(only('r = 2').type, 'polar');
  assert.match(parsePlot('theta = 1').errors[0].message, /reserved/);
});
