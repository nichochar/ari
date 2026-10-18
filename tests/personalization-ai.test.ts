import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../server/state.js';
import { aiSchemas, type AIAsk, type AITask } from '../server/ai.js';
import { createPersonalizedAsk } from '../server/personalization-ai.js';
import { PersonalizationWorkspace } from '../server/personalization.js';
import { LearningProviderError } from '../server/learning-provider.js';
import { fixtureLearningProvider } from './fixtures/learning.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ari-personalized-ai-'));
  const store = new StateStore(join(dir, 'state.sqlite'));
  const workspace = new PersonalizationWorkspace(store, join(dir, 'workspace'));
  await workspace.ready();
  return { store, workspace, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('interactive tutoring receives structured image requests and file tools, persists edits, and refreshes the next turn', async () => {
  const fx = await fixture();
  let baseCalls = 0, modelCalls = 0, mutations = 0;
  const base: AIAsk = async () => { baseCalls++; return {}; };
  const reply = { kind: 'explanation', feedback: 'Use a diagram first.', nextStep: '', question: '', observation: '', score: null, criteria: [], readable: false, confidence: 'medium', workRelevant: false, workLegible: false, assessmentRequested: false };
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const provider = { ...fixtureLearningProvider(), run: async (request: Parameters<ReturnType<typeof fixtureLearningProvider>['run']>[0]) => {
    assert.deepEqual(request.outputSchema, aiSchemas.tutor);
    assert.equal(request.ephemeral, true);
    assert.equal(request.runKey, undefined);
    assert.equal(request.input.length, 1);
    assert.match(request.instructions, /<TUTOR.md>[\s\S]+<USER.md>/);
    assert.ok(request.tools.some(tool => tool.name === 'workspace_edit'));
    assert.ok(request.tools.every(tool => tool.name.startsWith('workspace_')));
    const user = request.input[0] as { role: string; content: { type: string; text?: string; image_url?: string }[] };
    assert.equal(user.role, 'user');
    assert.deepEqual(JSON.parse(user.content[0].text!), { learnerMessage: modelCalls ? 'Another question' : 'Use diagrams.' });
    if (!modelCalls++) {
      assert.equal(user.content[1].image_url, image);
      const current = await request.executeTool('workspace_read', { path: 'USER.md' }, 'read-user') as { hash: string };
      await request.executeTool('workspace_write', { path: 'USER.md', content: '# Learner\nPrefers diagrams before equations.', expectedHash: current.hash }, 'write-user');
      assert.match(await request.refreshInstructions!(), /Prefers diagrams before equations/);
    } else assert.match(request.instructions, /Prefers diagrams before equations/);
    return { output: [], text: JSON.stringify(reply), inputTokens: 100 };
  } };
  const ask = createPersonalizedAsk(base, provider, fx.workspace, async () => { mutations++; })!;
  try {
    assert.deepEqual(await ask('tutor', 'Help with this lesson.', { learnerMessage: 'Use diagrams.' }, [image]), reply);
    assert.match((await fx.workspace.read('USER.md')).content, /Prefers diagrams before equations/);
    assert.deepEqual(await ask('tutor', 'Help with this exercise.', { learnerMessage: 'Another question' }), reply);
    assert.equal(modelCalls, 2); assert.equal(baseCalls, 0); assert.equal(mutations, 1);
    assert.deepEqual((await fx.store.readLearning()).context, []);
  } finally { await fx.close(); }
});

test('generation, verification, planning and review preserve their configured task runner while receiving fresh core notes', async () => {
  const fx = await fixture();
  const seen: { task: AITask; instructions: string; payload: unknown; image: unknown }[] = [];
  const base: AIAsk = async (task, instructions, payload, image) => { seen.push({ task, instructions, payload, image }); return { configuredTask: task }; };
  const provider = { ...fixtureLearningProvider(), run: async () => { throw new Error('Non-tutor task must preserve its configured runner'); } };
  const ask = createPersonalizedAsk(base, provider, fx.workspace)!;
  try {
    const payload = { scope: 'Synthetic task' };
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    for (const task of ['generate', 'verify', 'plan', 'review'] as const) assert.deepEqual(await ask(task, 'Original task rules', payload, image), { configuredTask: task });
    for (const call of seen) { assert.match(call.instructions, /^Original task rules/); assert.match(call.instructions, /<TUTOR.md>/); assert.equal(call.payload, payload); assert.equal(call.image, image); }
    const tutor = await fx.workspace.read('TUTOR.md');
    await fx.workspace.write('TUTOR.md', '# Tutor\nAsk for a prediction first.', { expectedHash: tutor.hash, actor: 'user' });
    await ask('verify', 'Verify original scope', payload);
    assert.match(seen.at(-1)!.instructions, /Ask for a prediction first/);
  } finally { await fx.close(); }
});

test('a fixture without a tool provider keeps its supplied tutor and disabled tutoring stays disabled', async () => {
  const fx = await fixture();
  let calls = 0;
  const base: AIAsk = async (_task, instructions) => { calls++; assert.match(instructions, /<USER.md>/); return { fixture: true }; };
  try {
    const ask = createPersonalizedAsk(base, undefined, fx.workspace)!;
    assert.deepEqual(await ask('tutor', 'Fixture rules', {}), { fixture: true });
    assert.equal(calls, 1);
    assert.equal(createPersonalizedAsk(undefined, fixtureLearningProvider(), fx.workspace), undefined);
  } finally { await fx.close(); }
});

test('interactive provider failures propagate without falling back to another billing runner', async () => {
  const fx = await fixture();
  let baseCalls = 0;
  const failure = new LearningProviderError('CODEX_LIMIT', 'Synthetic usage limit.');
  const provider = { ...fixtureLearningProvider(), run: async () => { throw failure; } };
  const ask = createPersonalizedAsk(async () => { baseCalls++; return {}; }, provider, fx.workspace)!;
  try {
    await assert.rejects(ask('tutor', 'Tutor rules', {}), error => error === failure);
    assert.equal(baseCalls, 0);
  } finally { await fx.close(); }
});
