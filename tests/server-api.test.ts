import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { exercises, modules } from '../shared/curriculum.js';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { StateStore } from '../server/state.js';
import { normalizeGeneratedMath, type AIAsk } from '../server/ai.js';
import { LearningProviderError, type LearningAgentProvider } from '../server/learning-provider.js';
import { fixtureLearningProvider } from './fixtures/learning.js';

async function fixture(ai?: AIAsk, personalizationProvider?: LearningAgentProvider) {
  const dir = await mkdtemp(join(tmpdir(), 'ari-test-'));
  const path = join(dir, 'state.sqlite');
  const options = { dbPath: path, legacyStatePath: join(dir, 'legacy.json'), ai, aiConfigured: Boolean(ai), personalizationProvider, model: 'test' };
  let app = createApp(options);
  let server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  let url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); (app.locals.store as StateStore).close(); };
  const restart = async () => {
    await stop();
    app = createApp(options);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const close = async () => { await stop(); await rm(dir, { recursive: true, force: true }); };
  const request = (route: string, method = 'GET', data?: unknown, headers?: HeadersInit) => fetch(url + route, {
    method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { path, dir, close, restart, request };
}

test('personalization REST edits, history and restores persist and reject stale writes', async () => {
  const fx = await fixture();
  try {
    const view = await (await fx.request('/api/learning/personalization')).json();
    assert.equal(view.onboarding.status, 'new');
    const changed = await fx.request('/api/learning/personalization/file', 'PUT', { path: 'USER.md', content: '# Learner\nEnjoys drawing diagrams.', expectedHash: view.user.hash });
    assert.equal(changed.status, 200);
    const current = await changed.json();
    assert.equal((await fx.request('/api/learning/personalization/file', 'PUT', { path: 'USER.md', content: 'Stale overwrite', expectedHash: view.user.hash })).status, 409);
    const history = await (await fx.request('/api/learning/personalization/history?path=USER.md')).json();
    assert.equal(history.revisions.length, 2);
    const restored = await fx.request('/api/learning/personalization/restore', 'POST', { path: 'USER.md', revision: view.user.revision, expectedHash: current.hash });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).content, view.user.content);
    assert.equal((await fx.request('/api/learning/personalization/file?path=..%2Foutside.md')).status, 400);
    await fx.request('/api/profile', 'PATCH', { goal: 'Understand constellations' });
    let synced = await (await fx.request('/api/learning/personalization/file?path=USER.md')).json();
    assert.match(synced.content, /Understand constellations/);
    await fx.request('/api/profile', 'PATCH', { sessionMinutes: 30 });
    synced = await (await fx.request('/api/learning/personalization/file?path=USER.md')).json();
    assert.equal((synced.content.match(/Goal: Understand constellations/g) ?? []).length, 1);
    await fx.restart();
    assert.equal((await (await fx.request('/api/learning/personalization/file?path=USER.md')).json()).content, synced.content);
    const finished = await fx.request('/api/learning/onboarding/complete', 'POST', {});
    assert.equal(finished.status, 200);
    assert.equal((await finished.json()).onboarding.status, 'complete');
    assert.equal((await (await fx.request('/api/learning/onboarding/begin', 'POST', {})).json()).status, 'new');
    assert.equal((await (await fx.request('/api/learning/onboarding/skip', 'POST', {})).json()).status, 'skipped');
  } finally { await fx.close(); }
});

test('lesson and exercise tutoring reread edited personalization and exclude bulk legacy notes', async () => {
  const seen: Array<{ instructions: string; payload: unknown }> = [];
  const fx = await fixture(async (_task, instructions, payload) => { seen.push({ instructions, payload }); return tutorReply; });
  try {
    const view = await (await fx.request('/api/learning/personalization')).json();
    await fx.request('/api/learning/personalization/file', 'PUT', { path: 'USER.md', content: '# Learner\nLikes geometric intuition.', expectedHash: view.user.hash });
    await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: modules[0].id, message: 'Explain this idea.' });
    assert.match(seen[0].instructions, /Likes geometric intuition/);
    await fx.request('/api/learning/personalization/file', 'PUT', { path: 'TUTOR.md', content: '# Tutor\nUse concise diagrams before equations.', expectedHash: view.tutor.hash });
    await fx.request('/api/profile', 'PATCH', { sessionMinutes: 30 });
    await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'chat', message: 'Can you give a hint?' });
    assert.match(seen[1].instructions, /Use concise diagrams before equations/);
    assert.match(seen[1].instructions, /Likes geometric intuition/);
    assert.doesNotMatch(seen[1].instructions, /Name: Learner|Goal: Explore a subject/);
    for (const call of seen) {
      assert.match(call.instructions, /<TUTOR.md>[\s\S]+<USER.md>/);
      const payload = call.payload as Record<string, unknown>;
      assert.equal(payload.memories, undefined);
      assert.equal(payload.learnerNotes, undefined);
    }
  } finally { await fx.close(); }
});

test('tool-enabled tutoring preserves actionable provider errors without switching runners', async () => {
  let code = 'CODEX_LIMIT', baseCalls = 0;
  const provider = { ...fixtureLearningProvider(), run: async () => { throw new LearningProviderError(code, 'Synthetic provider failure.'); } };
  const fx = await fixture(async () => { baseCalls++; return tutorReply; }, provider);
  try {
    for (const [nextCode, status] of [['CODEX_LIMIT', 503], ['CODEX_TIMEOUT', 504], ['CODEX_AUTH', 503], ['CODEX_RATE_LIMIT', 429], ['API_CREDITS', 503]] as const) {
      code = nextCode;
      const response = await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: modules[0].id, message: 'Explain this idea.' });
      assert.equal(response.status, status);
      assert.doesNotMatch((await response.json()).error, /Synthetic provider failure/);
    }
    assert.equal(baseCalls, 0);
  } finally { await fx.close(); }
});

test('profile and progress persist with validated fields', async () => {
  const fx = await fixture();
  try {
    const initial = await (await fx.request('/api/state')).json();
    assert.equal(initial.profile.sessionMinutes, 25);
    const changed = await fx.request('/api/profile', 'PATCH', { language: 'fr', sessionMinutes: 40 });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).language, 'fr');
    const invalid = await fx.request('/api/profile', 'PATCH', { apiKey: 'do-not-save' });
    assert.equal(invalid.status, 400);
    const mismatch = await fx.request(`/api/progress/${exercises[0].id}`, 'PUT', { exerciseId: 'different' });
    assert.equal(mismatch.status, 400);
    const progress = await fx.request(`/api/progress/${exercises[0].id}`, 'PUT', { status: 'completed', confidence: 3, hintCount: 2 });
    assert.equal(progress.status, 200);
    assert.equal((await progress.json()).status, 'completed');
    const reopened = new StateStore(fx.path, { legacyPath: join(fx.dir, 'unused.json') });
    const onDisk = await reopened.read();
    reopened.close();
    assert.equal(onDisk.profile.sessionMinutes, 40);
    assert.equal(onDisk.progress[exercises[0].id].confidence, 3);
    assert.equal(onDisk.progress[exercises[0].id].hintCount, 2);
    assert.equal((onDisk.profile as unknown as Record<string, unknown>).apiKey, undefined);
  } finally { await fx.close(); }
});

test('unreadable work has no score, while its submitted image is journaled', async () => {
  const ai: AIAsk = async () => ({ kind: 'feedback', observation: 'Some marks are visible but no steps are legible.',
    feedback: 'Looks fine', nextStep: 'Continue', question: '', score: 100, readable: false, confidence: 'low',
    criteria: exercises[0].rubric.map(r => ({ criterion: r.criterion, awarded: r.points, max: r.points, comment: 'yes' })),
    workRelevant: true, workLegible: false });
  const fx = await fixture(ai);
  try {
    const image = 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
    const result = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'check', image });
    assert.equal(result.status, 200);
    const response = await result.json();
    assert.equal(response.kind, 'clarify');
    assert.equal(response.score, null);
    assert.deepEqual(response.criteria, []);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exercises[0].id].lastScore, null);
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].requestText, '');
    assert.ok(state.sessions[0].snapshotId);
    const photo = await fx.request(`/api/snapshots/${state.sessions[0].snapshotId}`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await photo.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally { await fx.close(); }
});

test('server computes rubric score and does not auto-complete progress', async () => {
  const rubric = exercises[0].rubric;
  const ai: AIAsk = async () => ({ kind: 'feedback', observation: 'I can read the learner’s equation.', feedback: 'One step needs checking.',
    nextStep: 'Check the units.', question: 'What are the slope units?', score: 100, readable: true, confidence: 'medium',
    criteria: rubric.map((r, i) => ({ criterion: r.criterion, awarded: i === 0 ? r.points : 0, max: r.points, comment: 'Observed' })),
    workRelevant: true, workLegible: true });
  const fx = await fixture(ai);
  try {
    const result = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'check', message: 'I wrote a slope equation.' });
    assert.equal(result.status, 200);
    const response = await result.json();
    const expected = Math.round(100 * rubric[0].points / rubric.reduce((sum, r) => sum + r.points, 0));
    assert.equal(response.score, expected);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exercises[0].id].status, 'started');
    assert.equal(state.progress[exercises[0].id].lastScore, expected);
  } finally { await fx.close(); }
});

test('hint requests suppress model scores and increment hint count', async () => {
  const ai: AIAsk = async () => ({ kind: 'feedback', observation: '', feedback: 'Start with the slope formula.',
    nextStep: 'Write the change in output.', question: 'What changes between the readings?', score: 100,
    readable: true, confidence: 'high', criteria: [], workRelevant: true, workLegible: true });
  const fx = await fixture(ai);
  try {
    const result = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'hint' });
    assert.equal(result.status, 200);
    const response = await result.json();
    assert.equal(response.kind, 'hint');
    assert.equal(response.score, null);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exercises[0].id].hintCount, 1);
    assert.equal(state.progress[exercises[0].id].lastScore, null);
  } finally { await fx.close(); }
});

test('question mode needs a question and stays ungraded', async () => {
  const ai: AIAsk = async () => ({ kind: 'feedback', observation: '', feedback: 'Slope is change in output over change in input.',
    nextStep: 'Identify two points.', question: '', score: 100, readable: true, confidence: 'high', criteria: [],
    workRelevant: true, workLegible: true });
  const fx = await fixture(ai);
  try {
    const missing = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'question' });
    assert.equal(missing.status, 400);
    const asked = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'question', message: 'What does slope mean?' });
    assert.equal(asked.status, 200);
    const response = await asked.json();
    assert.equal(response.kind, 'explanation');
    assert.equal(response.score, null);
    assert.deepEqual(response.criteria, []);
  } finally { await fx.close(); }
});

test('generated exercise persists only after independent verification', async () => {
  let verified = false;
  const ai: AIAsk = async (task, _instructions, payload) => {
    assert.equal((payload as { language: string }).language, 'en');
    if (task === 'verify') { verified = true; return { valid: true, reason: 'The arithmetic and rubric agree.' }; }
    return { title: 'Calibration practice', minutes: 20, prompt: 'A sensor reads 2 V at 0 s and 6 V at 2 s. Find its linear model.',
      starter: 'Write y = ax + b.', skills: ['linear modeling'], hints: ['Find the slope.', 'Find the intercept.', 'Substitute both readings.'],
      solution: 'The slope is (6-2)/(2-0)=2 V/s, and the intercept is 2 V. Thus y=2t+2.',
      answer: 'y(t)=2t+2 V, with t in seconds.', rubric: [{ criterion: 'Slope', points: 5 }, { criterion: 'Intercept and model', points: 5 }] };
  };
  const fx = await fixture(ai);
  try {
    const response = await fx.request('/api/exercises/generate', 'POST', { moduleId: exercises[0].moduleId, difficulty: 'practice' });
    assert.equal(response.status, 201);
    assert.equal(verified, true);
    const exercise = await response.json();
    assert.equal(exercise.generated, true);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.generatedExercises[0].id, exercise.id);
  } finally { await fx.close(); }
});

test('generated math fixes doubled commands while preserving matrix row breaks', () => {
  const slash = String.fromCharCode(92);
  const doubled = '$t' + slash.repeat(2) + 'geq0$';
  const matrix = '$' + slash + 'begin{pmatrix}a&b' + slash.repeat(2) + 'c&d' + slash + 'end{pmatrix}$';
  const fixed = normalizeGeneratedMath({ ...exercises[0], prompt: `${doubled} and ${matrix}` });
  assert.equal(fixed.prompt, `$t${slash}geq0$ and ${matrix}`);
});

test('image and origin validation, local plan fallback, and disabled AI', async () => {
  const fx = await fixture();
  try {
    assert.equal((await fx.request('/api/health')).status, 200);
    assert.equal((await (await fx.request('/api/health')).json()).aiConfigured, false);
    const badImage = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'hint', image: 'https://example.com/photo.jpg' });
    assert.equal(badImage.status, 400);
    const foreign = await fx.request('/api/profile', 'PATCH', { name: 'N' }, { Origin: 'https://example.com' });
    assert.equal(foreign.status, 403);
    const unavailable = await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'hint' });
    assert.equal(unavailable.status, 503);
    const plan = await fx.request('/api/plan', 'POST', {});
    assert.equal(plan.status, 200);
    const result = await plan.json();
    assert.match(result.title, /local/);
    assert.ok(result.weeks.length >= 1);
    assert.ok(result.weeks[0].sessions[0].exerciseId);
    const exportResponse = await fx.request('/api/export');
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get('content-disposition'), 'attachment; filename="ari-data.json"');
  } finally { await fx.close(); }
});

test('invalid legacy JSON stops migration and preserves original', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ari-corrupt-test-'));
  try {
    const legacyPath = join(dir, 'state.json');
    await writeFile(legacyPath, '{"profile":{"name":"partial"}}');
    assert.throws(() => new StateStore(join(dir, 'state.sqlite'), { legacyPath }), /Invalid legacy state/);
    assert.equal(await readFile(legacyPath, 'utf8'), '{"profile":{"name":"partial"}}');
    assert.equal((await readdir(dir)).some(name => name.startsWith('state.json.backup')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
const photo = (marker: number, size = 9) => {
  const bytes = Buffer.alloc(size, marker);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return `data:image/png;base64,${bytes.toString('base64')}`;
};
const tutorReply = { kind: 'explanation', observation: '', feedback: 'Write one equation.', nextStep: 'Choose a variable.', question: 'What do you know?',
  score: null, criteria: [], readable: true, confidence: 'medium', workRelevant: true, workLegible: true };

test('saved pages reload, submit in selected order, and survive removal in journal', async () => {
  const seen: Array<{ images: string | string[] | undefined; order: unknown; history: { content: string }[] }> = [];
  const ai: AIAsk = async (task, _instructions, payload, images) => {
    if (task !== 'tutor') throw new Error('Unexpected AI task');
    const p = payload as { imageOrder: unknown; history: { content: string }[] };
    seen.push({ images, order: p.imageOrder, history: p.history });
    return tutorReply;
  };
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    const first = await (await fx.request(`/api/exercises/${exerciseId}/pages`, 'POST', { image: photo(1) })).json();
    const second = await (await fx.request(`/api/exercises/${exerciseId}/pages`, 'POST', { image: photo(2) })).json();
    await fx.restart();
    const state = await (await fx.request('/api/state')).json();
    assert.deepEqual(state.exercisePages.map((page: { id: string }) => page.id), [first.id, second.id]);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'check', pageIds: [second.id, first.id], image: photo(3) })).status, 200);
    assert.deepEqual(seen[0].images, [photo(2), photo(1), photo(3)]);
    assert.deepEqual(seen[0].order, [
      { position: 1, source: 'saved page', description: 'Saved page 1 for this exercise.', pageId: second.id },
      { position: 2, source: 'saved page', description: 'Saved page 2 for this exercise.', pageId: first.id },
      { position: 3, source: 'current photo', description: 'Fresh current photo. It may overlap a saved page; count visible work only once.' },
    ]);
    const after = await (await fx.request('/api/state')).json();
    const saved = after.sessions[0];
    assert.deepEqual(saved.snapshotIds, [second.snapshotId, first.snapshotId, saved.snapshotId]);
    assert.equal((await fx.request(`/api/reflections`, 'POST', { exerciseId, confidence: 3, notes: 'Both pages matter.', pageIds: [first.id, second.id] })).status, 201);
    assert.deepEqual((await (await fx.request('/api/state')).json()).reflections[0].snapshotIds, [first.snapshotId, second.snapshotId]);
    assert.equal((await fx.request(`/api/exercises/${exerciseId}/pages/${first.id}`, 'DELETE')).status, 204);
    assert.equal((await fx.request(`/api/exercises/${exerciseId}/pages/${first.id}`, 'DELETE')).status, 404);
    await fx.restart();
    const remaining = await (await fx.request('/api/state')).json();
    assert.deepEqual(remaining.exercisePages.map((page: { id: string }) => page.id), [second.id]);
    assert.deepEqual(remaining.sessions[0].snapshotIds, saved.snapshotIds);
    assert.deepEqual(remaining.reflections[0].snapshotIds, [first.snapshotId, second.snapshotId]);
    assert.equal((await fx.request(`/api/snapshots/${first.snapshotId}`)).status, 200);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'chat', message: 'Continue.' })).status, 200);
    assert.match(seen[1].history[0].content, /3 photo/);
    assert.equal(seen[1].history[0].content.includes('base64'), false);
  } finally { await fx.close(); }
});

test('page selection rejects foreign, missing, repeated, and oversized requests', async () => {
  const fx = await fixture(async () => tutorReply);
  try {
    const first = exercises[0].id;
    const other = exercises[1].id;
    const page = await (await fx.request(`/api/exercises/${first}/pages`, 'POST', { image: photo(1) })).json();
    for (const pageIds of [[page.id, page.id], ['missing'], [page.id]]) {
      const exerciseId = pageIds.length === 1 && pageIds[0] === page.id ? other : first;
      assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'check', pageIds })).status, 400);
      assert.equal((await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 3, notes: '', pageIds })).status, 400);
    }
    assert.equal((await fx.request(`/api/exercises/${other}/pages/${page.id}`, 'DELETE')).status, 404);
    assert.equal((await fx.request(`/api/exercises/${first}/pages`, 'POST', { image: 'bad' })).status, 400);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: first, mode: 'check', image: '', message: 'Check this.' })).status, 400);
    assert.equal((await fx.request('/api/reflections', 'POST', { exerciseId: first, confidence: 3, notes: '', image: '' })).status, 400);
    for (let i = 1; i < 20; i++) assert.equal((await fx.request(`/api/exercises/${first}/pages`, 'POST', { image: photo(i + 1) })).status, 201);
    assert.equal((await fx.request(`/api/exercises/${first}/pages`, 'POST', { image: photo(22) })).status, 400);
    const all = (await (await fx.request('/api/state')).json()).exercisePages.map((item: { id: string }) => item.id);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: first, mode: 'check', pageIds: all, image: photo(23) })).status, 200);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: first, mode: 'check', pageIds: [...all, page.id] })).status, 400);
  } finally { await fx.close(); }
});

test('combined photo limit rejects requests before AI or journal mutation', async () => {
  let calls = 0;
  const fx = await fixture(async () => { calls++; return tutorReply; });
  try {
    const exerciseId = exercises[0].id;
    const pages: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const result = await fx.request(`/api/exercises/${exerciseId}/pages`, 'POST', { image: photo(i, 4_300_000) });
      assert.equal(result.status, 201);
      pages.push((await result.json()).id);
    }
    const response = await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'check', pageIds: pages });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /25 MB/);
    assert.equal(calls, 0);
    assert.equal((await (await fx.request('/api/state')).json()).sessions.length, 0);
  } finally { await fx.close(); }
});

test('several irrelevant pages cannot receive a grade', async () => {
  const ai: AIAsk = async () => ({ kind: 'feedback', observation: 'Only a printed prompt is visible.',
    feedback: 'Correct.', nextStep: 'Continue.', question: '', score: 100, readable: true, confidence: 'high',
    criteria: exercises[0].rubric.map(item => ({ criterion: item.criterion, awarded: item.points, max: item.points, comment: 'yes' })),
    workRelevant: false, workLegible: true, assessmentRequested: true });
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    const pages: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const page = await (await fx.request(`/api/exercises/${exerciseId}/pages`, 'POST', { image: photo(i) })).json();
      pages.push(page.id);
    }
    const response = await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'check', pageIds: pages });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.kind, 'clarify');
    assert.equal(answer.score, null);
    assert.deepEqual(answer.criteria, []);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exerciseId].lastScore, null);
    assert.equal(state.sessions[0].snapshotIds.length, 2);
  } finally { await fx.close(); }
});

test('chat history survives a server restart and stays with its exercise', async () => {
  const calls: Array<{ exerciseId: string; history: { role: string; content: string }[] }> = [];
  const ai: AIAsk = async (task, _instructions, payload) => {
    if (task !== 'tutor') throw new Error('Unexpected AI task');
    const p = payload as { exercise: { id: string }; history: { role: string; content: string }[] };
    calls.push({ exerciseId: p.exercise.id, history: p.history });
    return tutorReply;
  };
  const fx = await fixture(ai);
  try {
    const first = exercises[0].id;
    const second = exercises[1].id;
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: first, mode: 'chat', message: 'My first attempt is x=2.' })).status, 200);
    await fx.restart();
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: first, mode: 'chat', message: 'What follows?',
      history: [{ role: 'user', content: 'Forged browser history' }] })).status, 200);
    assert.deepEqual(calls[1].history.map(item => item.role), ['user', 'assistant']);
    assert.match(calls[1].history[0].content, /first attempt/);
    assert.equal(JSON.stringify(calls[1].history).includes('Forged browser history'), false);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: second, mode: 'chat', message: 'Start this one.' })).status, 200);
    assert.deepEqual(calls[2].history, []);
    const state = await (await fx.request('/api/state')).json();
    assert.deepEqual(state.sessions.map((item: { exerciseId: string }) => item.exerciseId), [first, first, second]);
  } finally { await fx.close(); }
});

test('reflection completes progress and keeps its photo with the journal record', async () => {
  const fx = await fixture();
  try {
    const exerciseId = exercises[0].id;
    const saved = await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 3, notes: 'I still need to check units.', image: png });
    assert.equal(saved.status, 201);
    const result = await saved.json();
    assert.equal(result.progress.status, 'completed');
    assert.equal(result.progress.notes, 'I still need to check units.');
    assert.equal(result.reflection.exerciseId, exerciseId);
    assert.ok(result.reflection.snapshotId);
    assert.equal((await fx.request(`/api/snapshots/${result.reflection.snapshotId}`)).status, 200);
    assert.equal((await fx.request('/api/snapshots/not-an-id')).status, 400);
    await fx.restart();
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.reflections[0].snapshotId, result.reflection.snapshotId);
    assert.equal(state.progress[exerciseId].notes, result.reflection.notes);
  } finally { await fx.close(); }
});

test('daily review uses dated evidence, is idempotent, and stores observations for selective retrieval', async () => {
  const seen: Array<{ task: string; payload: unknown; instructions: string }> = [];
  const ai: AIAsk = async (task, instructions, payload) => {
    seen.push({ task, payload, instructions });
    if (task === 'review') return { summary: 'One equation attempted and reflected on.', strengths: [], gaps: ['Units need review'],
      nextSteps: ['Try a stretch problem with a units check'], memories: ['Alex wants quicker difficulty progression but checks units carefully.'],
      recommendedModuleIds: [exercises[0].moduleId], pace: 'accelerate' };
    if (task === 'tutor') return tutorReply;
    return {};
  };
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'chat', message: 'My equation is y=2x.' });
    await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 3, notes: 'Need more unit practice.' });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const reviewRequest = { date, timeZone: 'America/Los_Angeles' };
    const reviewed = await fx.request('/api/reviews/daily', 'POST', reviewRequest);
    assert.equal(reviewed.status, 200);
    const review = await reviewed.json();
    assert.equal(review.evidenceSessionIds.length, 1);
    assert.equal(review.evidenceReflectionIds.length, 1);
    assert.equal(review.pace, 'accelerate');
    assert.equal((await fx.request('/api/reviews/daily', 'POST', reviewRequest)).status, 200);
    assert.equal(seen.filter(call => call.task === 'review').length, 1);
    const evidence = seen.find(call => call.task === 'review')!.payload as { sessions: unknown[]; reflections: unknown[] };
    assert.equal(evidence.sessions.length, 1);
    assert.equal(evidence.reflections.length, 1);
    assert.equal(JSON.stringify(evidence).includes('data:image/'), false);
    await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'chat', message: 'Another attempt.' });
    const plan = await (await fx.request('/api/plan', 'POST', {})).json();
    const chatPayload = seen.filter(call => call.task === 'tutor').at(-1)!.payload as { memories: string[] };
    const planPayload = seen.find(call => call.task === 'plan')!.payload as { memories: string[]; completedModuleIds: string[];
      candidateSchedule: Array<{ sessions: Array<{ moduleId: string }> }> };
    assert.equal(chatPayload.memories, undefined);
    assert.equal(planPayload.memories, undefined);
    const note = await (await fx.request(`/api/learning/personalization/file?path=${encodeURIComponent(`memories/reviews/${review.date}-${review.id}.md`)}`)).json();
    assert.match(note.content, /Alex wants quicker difficulty progression/);
    for (const call of seen) { assert.match(call.instructions, /<TUTOR.md>[\s\S]+<USER.md>/); assert.doesNotMatch(call.instructions, /Alex wants quicker difficulty progression/); }
    assert.deepEqual(planPayload.completedModuleIds, []);
    assert.equal(planPayload.candidateSchedule[0].sessions[0].moduleId, exercises[0].moduleId);
    assert.match(plan.adjustment, /review informed/);
    await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 4, notes: 'Units now clearer.' });
    const revised = await (await fx.request('/api/reviews/daily', 'POST', reviewRequest)).json();
    assert.notEqual(revised.evidenceFingerprint, review.evidenceFingerprint);
    assert.equal(revised.evidenceReflectionIds.length, 2);
    assert.equal(seen.filter(call => call.task === 'review').length, 2);
  } finally { await fx.close(); }
});

test('AI planning receives completed modules and an order that satisfies prerequisites', async () => {
  let candidate: { weeks: unknown[] } | undefined;
  let completed: string[] = [];
  const ai: AIAsk = async (task, _instructions, payload) => {
    if (task !== 'plan') return tutorReply;
    const p = payload as { completedModuleIds: string[]; candidateSchedule: unknown[] };
    completed = p.completedModuleIds;
    candidate = { weeks: p.candidateSchedule };
    return { title: 'Adaptive tutor plan', summary: 'Start with the next available topics.', adjustment: 'Functions are complete.', weeks: p.candidateSchedule };
  };
  const fx = await fixture(ai);
  try {
    for (const exercise of exercises.filter(item => item.moduleId === 'functions'))
      await fx.request(`/api/progress/${exercise.id}`, 'PUT', { status: 'completed', confidence: 4 });
    const result = await (await fx.request('/api/plan', 'POST', {})).json();
    assert.deepEqual(completed, ['functions']);
    assert.equal(candidate?.weeks.length, 4);
    assert.equal(result.title, 'Adaptive tutor plan');
    assert.equal(result.weeks[0].sessions[0].moduleId, 'units-vectors');
  } finally { await fx.close(); }
});

test('review failure does not erase completed work or reflection', async () => {
  const ai: AIAsk = async task => { if (task === 'review') throw new Error('AI_TIMEOUT'); return tutorReply; };
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 2, notes: 'Try again tomorrow.' });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    assert.equal((await fx.request('/api/reviews/daily', 'POST', { date, timeZone: 'UTC' })).status, 504);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exerciseId].status, 'completed');
    assert.equal(state.reflections.length, 1);
    assert.equal(state.dailyReviews.length, 0);
  } finally { await fx.close(); }
});

test('Send never grades even when the model recognizes assessment intent and returns a full rubric', async () => {
  const rubric = exercises[0].rubric;
  const ai: AIAsk = async (_task, instructions) => {
    assert.match(instructions, /This request continues a conversation/);
    assert.doesNotMatch(instructions, /The learner selected Grade my work/);
    return { kind: 'feedback', observation: 'The learner wrote a relevant slope calculation.', feedback: 'Divide the change in output by the change in time.',
      nextStep: 'Check the units.', question: '', score: 100, readable: true, confidence: 'high',
      criteria: rubric.map(item => ({ criterion: item.criterion, awarded: item.points, max: item.points, comment: 'Visible calculation' })),
      workRelevant: true, workLegible: true, assessmentRequested: true };
  };
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    for (const message of ['What should I try?', 'Is this correct?', 'Vérifie mon calcul, s’il te plaît.', 'Please grade this.']) {
      const result = await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'chat', message, image: png });
      assert.equal(result.status, 200);
      const response = await result.json();
      assert.equal(response.kind, 'explanation');
      assert.equal(response.score, null);
      assert.deepEqual(response.criteria, []);
      assert.equal(response.feedback, 'Divide the change in output by the change in time.');
    }
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exerciseId].lastScore, null);
    assert.equal(state.sessions.length, 4);
    assert.ok(state.sessions.every((session: { response: { score: unknown }; snapshotId: string }) =>
      session.response.score === null && session.snapshotId === state.sessions[0].snapshotId));
  } finally { await fx.close(); }
});

test('a chat question with an irrelevant or unreadable photo still receives an explanation, not a grading failure', async () => {
  const fx = await fixture(async () => ({ ...tutorReply, kind: 'feedback', feedback: 'Slope is change in output divided by change in time.',
    assessmentRequested: true, workRelevant: false, workLegible: false, readable: false }));
  try {
    const response = await (await fx.request('/api/tutor', 'POST', { exerciseId: exercises[0].id, mode: 'chat', message: 'Why do I divide by time?', image: png })).json();
    assert.equal(response.kind, 'explanation');
    assert.equal(response.feedback, 'Slope is change in output divided by change in time.');
    assert.equal(response.score, null);
    assert.deepEqual(response.criteria, []);
  } finally { await fx.close(); }
});

test('review rejects an empty local day and includes legacy progress in later evidence', async () => {
  const calls: unknown[] = [];
  const ai: AIAsk = async (task, _instructions, payload) => {
    if (task === 'review') { calls.push(payload); return { summary: 'A completed exercise is recorded.', strengths: [], gaps: [],
      nextSteps: [], memories: [], recommendedModuleIds: [], pace: 'continue' }; }
    return tutorReply;
  };
  const fx = await fixture(ai);
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const request = { date, timeZone: 'UTC' };
    assert.equal((await fx.request('/api/reviews/daily', 'POST', request)).status, 400);
    assert.equal(calls.length, 0);
    await fx.request(`/api/progress/${exercises[0].id}`, 'PUT', { status: 'completed', confidence: 5 });
    assert.equal((await fx.request('/api/reviews/daily', 'POST', request)).status, 200);
    const evidence = calls[0] as { profile: { language: string; goal: string }; progress: Array<{ exerciseId: string; confidence: number }> };
    assert.equal(evidence.profile.language, 'en');
    assert.equal(evidence.profile.goal, undefined);
    assert.deepEqual(evidence.progress.map(item => [item.exerciseId, item.confidence]), [[exercises[0].id, 5]]);
  } finally { await fx.close(); }
});

test('Grade then Send preserves assessment context and score across reloads without regrading', async () => {
  const rubric = exercises[0].rubric;
  let laterHistory: { role: string; content: string }[] = [];
  const ai: AIAsk = async (_task, instructions, payload) => {
    const p = payload as { mode: string; learnerMessage: string; history: { role: string; content: string }[] };
    if (p.mode === 'chat') {
      laterHistory = p.history;
      assert.match(instructions, /This request continues a conversation/);
      assert.doesNotMatch(instructions, /grade ONLY the visible or typed steps/);
    } else {
      assert.match(instructions, /The learner selected Grade my work/);
      assert.doesNotMatch(instructions, /This request continues a conversation/);
    }
    // Deliberately simulate an overeager model grading a follow-up. The server must reject that grade.
    return { kind: 'feedback', observation: 'The learner wrote a relevant slope calculation.', feedback: p.mode === 'check' ? 'The first step is sound.' : 'The units follow from dividing voltage by time.',
      nextStep: 'Check units.', question: '', score: 100, readable: true, confidence: 'medium',
      criteria: rubric.map((item, index) => ({ criterion: item.criterion, awarded: p.mode === 'chat' || !index ? item.points : 0,
        max: item.points, comment: index ? 'Not shown' : 'Visible calculation' })),
      workRelevant: true, workLegible: true, assessmentRequested: true };
  };
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    const graded = await (await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'check', message: 'I calculated the slope.', image: png })).json();
    assert.equal(graded.kind, 'feedback');
    assert.ok(graded.score > 0 && graded.score < 100);
    const followup = await (await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'chat', message: 'Why are the units wrong? Is this correct now?', image: photo(2) })).json();
    assert.equal(followup.kind, 'explanation');
    assert.equal(followup.score, null);
    assert.deepEqual(followup.criteria, []);
    assert.equal(followup.feedback, 'The units follow from dividing voltage by time.');
    assert.match(laterHistory[1].content, /Observation: The learner wrote/);
    assert.match(laterHistory[1].content, /Score: \d+%/);
    assert.match(laterHistory[1].content, /Visible calculation/);
    await fx.restart();
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.progress[exerciseId].lastScore, graded.score);
    assert.equal(state.sessions.length, 2);
    assert.equal(state.sessions[0].response.score, graded.score);
    assert.equal(state.sessions[1].response.score, null);
    assert.ok(state.sessions.every((session: { exerciseId: string; snapshotId: string }) => session.exerciseId === exerciseId && session.snapshotId));
    assert.notEqual(state.sessions[0].snapshotId, state.sessions[1].snapshotId);
    const regraded = await (await fx.request('/api/tutor', 'POST', { exerciseId, mode: 'check', image: png })).json();
    assert.equal(regraded.score, graded.score);
  } finally { await fx.close(); }
});

test('new reflection during review prevents stale evidence from becoming the saved review', async () => {
  let releaseFirst!: () => void;
  let enteredFirst!: () => void;
  const entered = new Promise<void>(resolve => { enteredFirst = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let reviews = 0;
  const ai: AIAsk = async task => {
    if (task !== 'review') return tutorReply;
    reviews++;
    if (reviews === 1) { enteredFirst(); await firstGate; }
    return { summary: 'Review based on saved reflections.', strengths: [], gaps: [], nextSteps: ['Try one more step.'], memories: [],
      recommendedModuleIds: [], pace: 'continue' };
  };
  const fx = await fixture(ai);
  try {
    const exerciseId = exercises[0].id;
    await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 2, notes: 'First reflection.' });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const request = { date, timeZone: 'UTC' };
    const first = fx.request('/api/reviews/daily', 'POST', request);
    await entered;
    await fx.request('/api/reflections', 'POST', { exerciseId, confidence: 3, notes: 'Second reflection.' });
    const second = fx.request('/api/reviews/daily', 'POST', request);
    releaseFirst();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.dailyReviews.length, 1);
    assert.equal(state.dailyReviews[0].evidenceReflectionIds.length, 2);
    assert.equal(reviews, 2);
  } finally { await fx.close(); }
});

test('lesson conversation receives the actual lesson, remembers turns after restart and stays isolated from exercise progress', async () => {
  const seen: Array<{ task: string; instructions: string; payload: any; image: unknown }> = [];
  const fx = await fixture(async (task, instructions, payload, image) => {
    seen.push({ task, instructions, payload, image });
    return { ...tutorReply, kind: 'feedback', observation: 'Invented work observation', score: 100,
      criteria: [{ criterion: 'Invented rubric', awarded: 10, max: 10, comment: 'Mastered' }] };
  });
  try {
    const module = modules[0];
    const before = await (await fx.request('/api/state')).json();
    const first = { id: randomUUID(), moduleId: module.id, message: 'Call this idea my compass.' };
    const saved = await (await fx.request('/api/lesson-chat', 'POST', first)).json();
    assert.equal(saved.id, first.id);
    assert.equal(saved.moduleId, module.id);
    assert.equal(saved.language, 'en');
    assert.equal(saved.response.kind, 'explanation');
    assert.equal(saved.response.observation, '');
    assert.equal(saved.response.score, null);
    assert.equal(saved.response.readable, false);
    assert.deepEqual(saved.response.criteria, []);
    assert.equal(seen[0].task, 'tutor');
    assert.match(seen[0].instructions, /lesson conversation/);
    assert.equal(seen[0].image, undefined);
    assert.equal(seen[0].payload.lesson.primer, module.primer);
    assert.equal(seen[0].payload.lesson.summary, module.summary);
    assert.deepEqual(seen[0].payload.lesson.objectives, module.objectives);
    assert.deepEqual(seen[0].payload.lesson.prerequisites, module.prerequisites);
    assert.deepEqual(seen[0].payload.profile, { language: before.profile.language, sessionMinutes: before.profile.sessionMinutes, sessionsPerWeek: before.profile.sessionsPerWeek });
    assert.deepEqual(seen[0].payload.history, []);
    assert.equal(seen[0].payload.exercise, undefined);
    assert.equal(JSON.stringify(seen[0].payload).includes('rubric'), false);
    assert.equal(JSON.stringify(seen[0].payload).includes('solution'), false);
    await fx.restart();
    await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: modules[1].id, message: 'Another lesson', language: 'fr' });
    assert.deepEqual(seen[1].payload.history, []);
    assert.equal(seen[1].payload.language, 'fr');
    await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: module.id, message: 'What did I call it?' });
    assert.equal(seen[2].payload.history.length, 2);
    assert.equal(seen[2].payload.history[0].content, first.message);
    assert.match(seen[2].payload.history[1].content, /Write one equation/);
    assert.equal(JSON.stringify(seen[2].payload.history).includes('Another lesson'), false);
    const state = await (await fx.request('/api/state')).json();
    assert.equal(state.lessonSessions.length, 3);
    for (const field of ['progress', 'sessions', 'reflections', 'exercisePages', 'plan']) assert.deepEqual(state[field], before[field]);
    assert.deepEqual((await (await fx.request('/api/export')).json()).lessonSessions, state.lessonSessions);
  } finally { await fx.close(); }
});

test('lesson retries coalesce, replay after restart, and reject payload conflicts', async () => {
  let calls = 0;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fx = await fixture(async () => { calls++; entered(); await gate; return tutorReply; });
  try {
    const input = { id: randomUUID(), moduleId: modules[0].id, message: 'Explain this idea.' };
    const first = fx.request('/api/lesson-chat', 'POST', input);
    await started;
    const duplicate = fx.request('/api/lesson-chat', 'POST', input);
    assert.equal((await fx.request('/api/lesson-chat', 'POST', { ...input, language: 'fr' })).status, 409);
    assert.equal((await fx.request('/api/lesson-chat', 'POST', { ...input, message: 'Changed' })).status, 409);
    release();
    const saved = await (await first).json();
    assert.deepEqual(await (await duplicate).json(), saved);
    assert.equal(calls, 1);
    await fx.request('/api/profile', 'PATCH', { language: 'fr' });
    await fx.restart();
    assert.deepEqual(await (await fx.request('/api/lesson-chat', 'POST', input)).json(), saved);
    assert.equal((await fx.request('/api/lesson-chat', 'POST', { ...input, moduleId: modules[1].id })).status, 409);
    assert.equal((await fx.request('/api/lesson-chat', 'POST', { ...input, language: 'fr' })).status, 409);
    assert.equal(calls, 1);
    assert.equal((await (await fx.request('/api/state')).json()).lessonSessions.length, 1);
  } finally { release(); await fx.close(); }
});

test('lesson request validation and AI failures leave no lesson exchange or progress and permit retry', async () => {
  let failure: unknown = new Error('AI_TIMEOUT');
  const fx = await fixture(async () => { if (failure instanceof Error) throw failure; return failure ?? tutorReply; });
  try {
    const valid = { id: randomUUID(), moduleId: modules[0].id, message: 'What is this?' };
    for (const patch of [{ id: 'invalid' }, { message: ' ' }, { message: 'x'.repeat(4001) }, { language: 'es' }, { image: 'ignored' }])
      assert.equal((await fx.request('/api/lesson-chat', 'POST', { ...valid, ...patch })).status, 400);
    assert.equal((await fx.request('/api/lesson-chat', 'POST', { ...valid, moduleId: 'unknown' })).status, 404);
    assert.equal((await fx.request('/api/lesson-chat', 'POST', valid)).status, 504);
    failure = { feedback: 'Malformed response' };
    assert.equal((await fx.request('/api/lesson-chat', 'POST', valid)).status, 502);
    let state = await (await fx.request('/api/state')).json();
    assert.deepEqual(state.lessonSessions, []);
    assert.deepEqual(state.progress, {});
    failure = null;
    assert.equal((await fx.request('/api/lesson-chat', 'POST', valid)).status, 200);
    state = await (await fx.request('/api/state')).json();
    assert.equal(state.lessonSessions.length, 1);
  } finally { await fx.close(); }
  const offline = await fixture();
  try { assert.equal((await offline.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: modules[0].id, message: 'Hi' })).status, 503); }
  finally { await offline.close(); }
});

test('lesson-only daily reviews use dated lesson evidence and keep observations out of unrelated lesson context', async () => {
  const seen: Array<{ task: string; payload: any }> = [];
  const fx = await fixture(async (task, _instructions, payload) => {
    seen.push({ task, payload });
    if (task === 'review') return { summary: 'Discussed a concept.', strengths: [], gaps: [], nextSteps: ['Try a small example'],
      memories: ['Prefers compass analogies'], recommendedModuleIds: [modules[0].id], pace: 'continue' };
    return tutorReply;
  });
  try {
    const first = await (await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: modules[0].id, message: 'Use a compass analogy.' })).json();
    const input = { date: new Date().toISOString().slice(0, 10), timeZone: 'UTC' };
    const response = await fx.request('/api/reviews/daily', 'POST', input);
    assert.equal(response.status, 200);
    const review = await response.json();
    assert.deepEqual(review.evidenceLessonSessionIds, [first.id]);
    assert.deepEqual(review.evidenceSessionIds, []);
    assert.deepEqual(review.evidenceReflectionIds, []);
    const payload = seen.find(call => call.task === 'review')!.payload;
    assert.deepEqual(payload.lessonSessions.map((item: any) => item.id), [first.id]);
    assert.deepEqual(payload.progress, []);
    assert.deepEqual(await (await fx.request('/api/reviews/daily', 'POST', input)).json(), review);
    assert.equal(seen.filter(call => call.task === 'review').length, 1);
    await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: modules[0].id, message: 'Another concept.' });
    assert.equal(seen.at(-1)!.payload.memories, undefined);
    const note = await (await fx.request(`/api/learning/personalization/file?path=${encodeURIComponent(`memories/reviews/${review.date}-${review.id}.md`)}`)).json();
    assert.match(note.content, /Prefers compass analogies/);
    const revised = await (await fx.request('/api/reviews/daily', 'POST', input)).json();
    assert.notEqual(revised.evidenceFingerprint, review.evidenceFingerprint);
    assert.equal(revised.evidenceLessonSessionIds.length, 2);
    assert.equal((await fx.request('/api/reviews/daily', 'POST', { ...input, date: '2000-01-01' })).status, 400);
  } finally { await fx.close(); }
});
