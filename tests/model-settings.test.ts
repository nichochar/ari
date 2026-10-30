import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore } from '../server/state.js';
import { createApp } from '../server/app.js';
import { createModelRuntime, ModelSettingsService, switchingProvider } from '../server/model-runtime.js';
import { defaultModelSelection, type ModelOption, type ModelSelection } from '../shared/model-settings.js';
import { fixtureLearningProvider } from './fixtures/learning.js';
import type { LearningAgentRequest } from '../server/learning-provider.js';
import type { AddressInfo } from 'node:net';

const models: ModelOption[] = [
  { id: 'gpt-6-astra', name: 'Astra', efforts: ['low', 'high'], defaultEffort: 'high' },
  { id: 'gpt-6-luna', name: 'Luna', efforts: ['low', 'medium'], defaultEffort: 'medium' },
];
test('model selection validates current capabilities and persists without changing learner data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ari-models-'));
  let store = new StateStore(join(dir, 'state.sqlite'));
  let online = true;
  const catalog = async () => { if (!online) throw new Error('offline'); return models; };
  try {
    const before = await store.read(), learning = await store.readLearning();
    const settings = new ModelSettingsService(store, defaultModelSelection, catalog);
    assert.deepEqual((await settings.view()).selection, defaultModelSelection);
    await assert.rejects(settings.save({ model: 'unlisted-model', reasoningEffort: 'high' }), { code: 'MODEL_SELECTION' });
    await assert.rejects(settings.save({ model: 'gpt-6-luna', reasoningEffort: 'ultra' }), { code: 'MODEL_SELECTION' });
    assert.equal(store.readModelSelection(), undefined);
    const chosen: ModelSelection = { model: 'gpt-6-luna', reasoningEffort: 'low' };
    await settings.save(chosen);
    online = false;
    await assert.rejects(settings.save(defaultModelSelection), /offline/);
    assert.deepEqual(store.readModelSelection(), chosen);
    assert.deepEqual(await store.read(), before); assert.deepEqual(await store.readLearning(), learning);
    store.close(); store = new StateStore(join(dir, 'state.sqlite'));
    assert.deepEqual(new ModelSettingsService(store, defaultModelSelection, catalog).selection(), chosen);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('changing model applies to new calls while a running reply retains its provider and context', async () => {
  let selection = { ...defaultModelSelection };
  const calls: string[] = [], closed: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider = switchingProvider(() => selection, selected => ({ ...fixtureLearningProvider(),
    model: `${selected.model}/${selected.reasoningEffort}`, managesCompaction: true,
    close: () => { closed.push(selected.model); },
    run: async request => {
      calls.push(`${selected.model}/${selected.reasoningEffort}`);
      if (selected.model === 'gpt-6-astra') await gate;
      await request.onCompaction?.({ status: 'started' });
      await request.onCompaction?.({ status: 'completed' });
      return { text: selected.model, output: [], context: request.input, inputTokens: 12 };
    },
  }));
  const context = [{ type: 'opaque-history', id: 'saved' }];
  const request: LearningAgentRequest = { instructions: '', input: context, tools: [], executeTool: async () => null };
  const first = provider.run(request);
  selection = { model: 'gpt-6-luna', reasoningEffort: 'low' };
  const states: string[] = [];
  const second = await provider.run({ ...request, onCompaction: event => { states.push(event.status); } });
  assert.deepEqual(closed, []);
  assert.deepEqual(second.context, context);
  assert.deepEqual(states, ['started', 'completed']);
  release(); assert.equal((await first).text, 'gpt-6-astra');
  assert.deepEqual(calls, ['gpt-6-astra/high', 'gpt-6-luna/low']);
  assert.deepEqual(closed, ['gpt-6-astra']);
  provider.close?.(); assert.deepEqual(closed, ['gpt-6-astra', 'gpt-6-luna']);
});

test('runtime defaults to Astra high and keeps the chosen billing connections explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ari-model-runtime-'));
  const db = join(dir, 'state.sqlite'), store = new StateStore(db);
  const runtime = createModelRuntime(store, db, {});
  try {
    assert.deepEqual(runtime.settings.selection(), defaultModelSelection);
    assert.equal(runtime.learningProvider?.model, 'gpt-6-astra · high · Codex');
    assert.equal(runtime.personalizationProvider?.model, 'gpt-6-astra · high · Codex');
    const api = createModelRuntime(store, db, { ARI_MAIN_PROVIDER: 'openai', ARI_AI_PROVIDER: 'openai' });
    assert.equal(api.learningProvider, undefined); assert.equal(api.ai, undefined);
    await assert.rejects(api.settings.view(), { code: 'MODEL_CONNECTION' }); api.close();
    assert.throws(() => createModelRuntime(store, db, { ARI_MAIN_PROVIDER: 'other' }));
  } finally { runtime.close(); store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('settings routes save validated choices, update health and reject unsupported efforts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ari-model-route-'));
  const app = createApp({ dbPath: join(dir, 'state.sqlite'), legacyStatePath: join(dir, 'none.json'), learningConfigured: false,
    runtimeFactory: store => {
      const settings = new ModelSettingsService(store, defaultModelSelection, async () => models);
      const provider = switchingProvider(settings.selection, selection => ({ ...fixtureLearningProvider(), model: `${selection.model}/${selection.reasoningEffort}` }));
      return { settings, learningProvider: provider, personalizationProvider: provider, close: () => provider.close?.() };
    } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const request = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, body ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  try {
    assert.deepEqual((await (await request('/api/model-settings')).json()).selection, defaultModelSelection);
    assert.equal((await request('/api/model-settings', { model: 'gpt-6-luna', reasoningEffort: 'ultra' })).status, 400);
    assert.equal((await request('/api/model-settings', { model: 'gpt-6-luna', reasoningEffort: 'low' })).status, 200);
    assert.equal((await (await request('/api/health')).json()).model, 'gpt-6-luna/low');
    assert.deepEqual((await (await request('/api/export')).json()).modelSelection, { model: 'gpt-6-luna', reasoningEffort: 'low' });
  } finally {
    app.locals.learning.stop(); app.locals.assessments.stop(); await app.locals.assessments.settle();
    app.locals.modelRuntime.close(); await new Promise<void>(resolve => server.close(() => resolve())); app.locals.store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
