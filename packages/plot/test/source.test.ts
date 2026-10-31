import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendLine, formatPoint, formatValue, niceStep, replaceLine, setParameterValue, snapValue, toggleHidden } from '../src/ui/source';

test('toggleHidden adds and removes the attribute', () => {
  assert.equal(toggleHidden('y = x^2'), 'y = x^2 { hidden }');
  assert.equal(toggleHidden('y = x^2 { hidden }'), 'y = x^2');
  assert.equal(toggleHidden('y = sin x { label: "a, b", color: blue }'), 'y = sin x { label: "a, b", color: blue, hidden }');
  assert.equal(toggleHidden('y = cos x { dashed, hidden }'), 'y = cos x { dashed }');
  assert.equal(toggleHidden('y = x # parabola'), 'y = x { hidden } # parabola');
  assert.equal(toggleHidden('y = x { color: #ff0000 } # note'), 'y = x { color: #ff0000, hidden } # note');
});

test('setParameterValue keeps the range and step text', () => {
  assert.equal(setParameterValue('a = 1 in [0, 2pi]', '1.5'), 'a = 1.5 in [0, 2pi]');
  assert.equal(setParameterValue('n = 3 in [1, 10]  step 1', '7'), 'n = 7 in [1, 10]  step 1');
  assert.equal(setParameterValue('k=2pi in [0,5] { label: "k" }', '-0.25'), 'k=-0.25 in [0,5] { label: "k" }');
  assert.equal(setParameterValue('a = 1 # angle', '2'), 'a = 2 # angle');
});

test('line editing', () => {
  assert.equal(replaceLine('a\nb\nc', 2, 'B'), 'a\nB\nc');
  assert.equal(replaceLine('a\nb\nc', 2, '  '), 'a\nc');
  assert.equal(appendLine('a\n\n', 'b'), 'a\nb');
  assert.equal(appendLine('', 'b'), 'b');
});

test('number formatting follows the step', () => {
  assert.equal(formatValue(1.23456, 0.01), '1.23');
  assert.equal(formatValue(2.5, 1), '3');
  assert.equal(formatValue(1.23456, Math.PI / 12), '1.235');
  assert.equal(formatValue(-0.0001, 0.01), '0');
  assert.equal(formatValue(1.5, 0.02), '1.5');
  assert.equal(snapValue(1.2345, 0, 0.02), 1.24);
  assert.equal(snapValue(3.7, 1, 1), 4);
});

test('default steps are round numbers', () => {
  assert.equal(niceStep(0, 5), 0.02);
  assert.equal(niceStep(0, 2 * Math.PI), 0.02);
  assert.equal(niceStep(-2.5, 2.5), 0.02);
  assert.equal(niceStep(0, 100), 0.5);
  assert.equal(niceStep(0, 1000), 5);
});

test('readout coordinates', () => {
  assert.equal(formatPoint(1.2345, -0.45), '(1.23, −0.45)');
  assert.equal(formatPoint(0, 123.456), '(0, 123)');
  assert.equal(formatPoint(-0.0004, 0.000123), '(−0.0004, 0.000123)');
});
