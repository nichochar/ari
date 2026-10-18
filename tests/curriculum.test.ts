import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticIds, exercises, modules } from '../shared/curriculum';

test('six paired phases form a usable path with real prerequisites', () => {
  assert.equal(modules.length, 12);
  assert.equal(exercises.length, 24);
  const seen = new Set<string>();
  for (let phase = 1; phase <= 6; phase += 1) {
    const pair = modules.filter(module => module.phase === phase);
    assert.deepEqual(pair.map(module => module.subject), ['math', 'physics']);
  }
  for (const module of modules) {
    assert.ok(module.id && module.title && module.frenchTitle && module.summary);
    assert.ok(module.primer.length >= 160, `primer too short: ${module.id}`);
    assert.ok(module.primer.includes('$'), `missing math notation: ${module.id}`);
    assert.ok(module.objectives.length >= 2);
    assert.equal(module.exerciseIds.length, 2);
    assert.ok(module.resources.length >= 1);
    for (const prerequisite of module.prerequisites) {
      assert.ok(seen.has(prerequisite), `missing or future prerequisite ${prerequisite} for ${module.id}`);
    }
    for (const resource of module.resources) {
      assert.ok(resource.title.length > 5);
      assert.match(resource.url, /^https:\/\/openstax\.org\/books\/[a-z0-9-]+\/pages\/[a-z0-9-]+$/);
    }
    seen.add(module.id);
  }
  assert.equal(seen.size, modules.length);
});

test('each exercise is linked, paced, scaffolded, and graded out of ten', () => {
  const ids = new Set<string>();
  const listed = new Set(modules.flatMap(module => module.exerciseIds));
  for (const exercise of exercises) {
    assert.ok(!ids.has(exercise.id), `duplicate exercise ${exercise.id}`);
    ids.add(exercise.id);
    assert.ok(listed.has(exercise.id), `unlisted exercise ${exercise.id}`);
    assert.equal(modules.find(module => module.id === exercise.moduleId)?.exerciseIds.includes(exercise.id), true);
    assert.ok(exercise.title && exercise.prompt && exercise.starter && exercise.solution && exercise.answer);
    assert.ok(exercise.prompt.includes('$'), `missing math in ${exercise.id}`);
    assert.ok(exercise.solution.length >= 120, `solution too short: ${exercise.id}`);
    assert.equal(exercise.hints.length, 3);
    assert.ok(exercise.hints.every(hint => hint.length >= 20));
    assert.ok(exercise.skills.length >= 2);
    assert.ok(exercise.minutes >= 10 && exercise.minutes <= 20);
    assert.ok(['warmup', 'practice', 'stretch'].includes(exercise.difficulty));
    assert.equal(exercise.rubric.reduce((sum, item) => sum + item.points, 0), 10);
    assert.ok(exercise.rubric.every(item => item.criterion.length >= 12 && item.points > 0));
    for (const text of [exercise.prompt, exercise.solution, exercise.answer, ...exercise.hints]) {
      assert.equal((text.match(/\$/g) ?? []).length % 2, 0, `unbalanced math delimiters in ${exercise.id}`);
      assert.ok(!/[\t\r\f]/.test(text), `escaped LaTeX command corrupted in ${exercise.id}`);
    }
  }
  assert.equal(ids.size, listed.size);
  assert.deepEqual([...ids].sort(), [...listed].sort());
});

test('diagnostic samples four distinct foundation skills without new content', () => {
  assert.equal(diagnosticIds.length, 4);
  assert.equal(new Set(diagnosticIds).size, 4);
  assert.deepEqual(diagnosticIds, ['sensor-calibration', 'drone-scale', 'track-tangent', 'braking-cart']);
  const exerciseIds = new Set(exercises.map(exercise => exercise.id));
  assert.ok(diagnosticIds.every(id => exerciseIds.has(id)));
  assert.equal(exercises[0].id, 'sensor-calibration');
  assert.equal(exercises[0].minutes, 10);
});

test('independent numerical spot checks match worked answers', () => {
  const byId = Object.fromEntries(exercises.map(exercise => [exercise.id, exercise]));
  // A quadratic stop and a signed-distance split catch common calculus mistakes.
  const stoppingTime = 12 / 3;
  const stoppingDistance = 12 * stoppingTime - 1.5 * stoppingTime ** 2;
  assert.equal(stoppingDistance, 24);
  assert.match(byId['braking-cart'].answer, /24/);
  const displacement = (4 ** 2 / 2 - 2 * 4) - 0;
  const distance = 2 + 2;
  assert.equal(displacement, 0);
  assert.equal(distance, 4);
  assert.match(byId['out-and-back'].answer, /distance \$4\$/);

  // Mesh equations must satisfy both loops and the shared branch direction.
  const left = 25 / 11;
  const right = 20 / 11;
  assert.equal(3 * left - right, 5);
  assert.equal(-left + 4 * right, 5);
  assert.ok(Math.abs(left - right - 5 / 11) < 1e-12);
  assert.match(byId['coupled-loops'].answer, /5\/11/);

  // The toy ensemble variance uses independence; it scales with N, not N².
  const epsilon = 2e-21;
  const variance = 100 * 0.2 * 0.8 * epsilon ** 2;
  assert.ok(Math.abs(variance / 6.4e-41 - 1) < 1e-12);
  assert.ok(Math.abs(Math.sqrt(variance) / 8e-21 - 1) < 1e-12);
  assert.match(byId['two-level-ensemble'].answer, /6\.4\\times10\^{-41}/);
});
