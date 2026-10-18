import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateStore } from '../server/state.js';
import { LearningService } from '../server/learning-service.js';
import { PersonalizationWorkspace } from '../server/personalization.js';
import { personalizationInstructions } from '../server/personalization-tools.js';
import type { LearningAgentProvider } from '../server/learning-provider.js';
import { fixtureLearningProvider } from './fixtures/learning.js';
import { exercises } from '../shared/curriculum.js';

async function fixture(provider = fixtureLearningProvider()) {
  const dir = await mkdtemp(join(tmpdir(), 'ari-personalization-runtime-'));
  const dbPath = join(dir, 'state.sqlite');
  let store = new StateStore(dbPath);
  let workspace = new PersonalizationWorkspace(store, join(dir, 'workspace'));
  let service = new LearningService(store, provider, workspace);
  await workspace.ready();
  return {
    store: () => store, workspace: () => workspace, service: () => service,
    chat: async (message: string) => { await service.chat({ id: randomUUID(), message }); await service.settle(); },
    restart: async () => { service.stop(); await service.settle(); store.close(); store = new StateStore(dbPath); workspace = new PersonalizationWorkspace(store, join(dir, 'workspace')); service = new LearningService(store, provider, workspace); await service.recover(); await service.settle(); },
    close: async () => { service.stop(); await service.settle(); store.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('every main turn gets current core documents and excludes archived and daily memory', async () => {
  const prompts: string[] = [];
  const base = fixtureLearningProvider();
  const fx = await fixture({ ...base, run: async request => { prompts.push(request.instructions); return base.run(request); } });
  try {
    await fx.store().updateLearning(d => { d.memory.content = 'Archived legacy detail that must stay off prompt'; });
    const workspace = fx.workspace();
    const user = await workspace.read('USER.md');
    await workspace.write('USER.md', '# Learner\nEnjoys astronomy.', { expectedHash: user.hash, actor: 'user' });
    await workspace.write('memories/old-observation.md', 'Unrelated daily detail that must stay off prompt', { expectedHash: null, actor: 'user' });
    await fx.chat('What is an orbit?');
    const tutor = await workspace.read('TUTOR.md');
    await workspace.write('TUTOR.md', '# Tutor\nStart with a visual analogy.', { expectedHash: tutor.hash, actor: 'user' });
    await fx.chat('Explain an ellipse.');
    assert.match(prompts[0], /Enjoys astronomy/);
    assert.doesNotMatch(prompts[0], /\"name\":\"Learner\"|\"goal\":\"Explore a subject/);
    assert.match(prompts[0], /USER.md is the current authority/);
    assert.match(prompts[1], /Start with a visual analogy/);
    for (const prompt of prompts) { assert.doesNotMatch(prompt, /Archived legacy detail|Unrelated daily detail/); assert.match(prompt, /<TUTOR.md>[\s\S]+<USER.md>/); }
  } finally { await fx.close(); }
});

test('main tools persist edits across reloads, refresh context, and replay one side effect', async () => {
  const base = fixtureLearningProvider();
  let writes = 0;
  const fx = await fixture({ ...base, run: async request => {
    if (writes++) return base.run(request);
    const user = await request.executeTool('workspace_read', { path: 'USER.md' }, 'read-user') as { hash: string };
    const args = { path: 'USER.md', content: '# Learner\nPrefers short practical examples.', expectedHash: user.hash };
    const first = await request.executeTool('workspace_write', args, 'save-user');
    const duplicate = await request.executeTool('workspace_write', args, 'save-user');
    assert.deepEqual(duplicate, first);
    assert.match(await request.refreshInstructions!(), /Prefers short practical examples/);
    assert.equal((await request.executeTool('complete_onboarding', {}, 'finish') as { onboarding: { status: string } }).onboarding.status, 'complete');
    return base.run(request);
  } });
  try {
    await fx.chat('Please use short practical examples.');
    const file = await fx.workspace().read('USER.md');
    assert.match(file.content, /Prefers short practical examples/);
    assert.equal((await fx.workspace().revisions('USER.md')).length, 2);
    await fx.restart();
    assert.equal((await fx.workspace().read('USER.md')).hash, file.hash);
    assert.match(await personalizationInstructions(fx.workspace()), /Prefers short practical examples/);
    assert.equal((await fx.workspace().onboarding()).status, 'complete');
    assert.equal((await fx.store().readLearning()).messages.filter(message => message.role === 'user').length, 1);
  } finally { await fx.close(); }
});

test('fresh onboarding seeds one friendly question; finish, skip and revisit preserve documents', async () => {
  const fx = await fixture();
  try {
    const first = await fx.service().view();
    assert.equal(first.personalization.onboarding.status, 'new');
    assert.equal(first.messages.length, 1);
    assert.match(first.messages[0].content, /What would you enjoy learning/);
    await fx.service().view();
    await fx.restart();
    assert.equal((await fx.service().view()).messages.length, 1);
    const before = await fx.workspace().read('USER.md');
    await fx.service().completeOnboarding();
    assert.equal((await fx.workspace().read('USER.md')).hash, before.hash);
    await fx.service().beginOnboarding();
    assert.equal((await fx.workspace().onboarding()).status, 'new');
    await fx.service().skipOnboarding();
    assert.equal((await fx.workspace().onboarding()).status, 'skipped');
    assert.equal((await fx.workspace().read('USER.md')).hash, before.hash);
    assert.equal((await fx.store().readLearning()).curricula.length, 1);
  } finally { await fx.close(); }
});

test('existing learner evidence skips first-time onboarding without injecting old memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ari-personalization-imported-'));
  const store = new StateStore(join(dir, 'state.sqlite'));
  try {
    await store.update(state => { state.profile.name = 'Synthetic Learner'; state.profile.goal = 'Understand optics'; });
    await store.updateLearning(d => { d.memory.content = 'Legacy observation from a prior tutor'; });
    const workspace = new PersonalizationWorkspace(store, join(dir, 'workspace'));
    const service = new LearningService(store, null, workspace);
    const view = await service.view();
    assert.equal(view.personalization.onboarding.status, 'imported');
    assert.equal(view.messages.length, 0);
    assert.match(view.personalization.user.content, /Synthetic Learner/);
    assert.doesNotMatch(await personalizationInstructions(workspace), /Legacy observation from a prior tutor/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('background review records dated scoped evidence and preserves concurrent USER changes', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { started = resolve; });
  const base = fixtureLearningProvider();
  const provider: LearningAgentProvider = { ...base, generate: async <T>(instructions: string) => {
    assert.match(instructions, /<TUTOR.md>/);
    started(); await gate;
    return { message: '', memory: 'Tentative: needs practice comparing sources, supported by this reflection only.' } as T;
  } };
  const fx = await fixture(provider);
  try {
    const id = randomUUID();
    await fx.store().update(state => { state.reflections.push({ id, exerciseId: exercises[0].id, createdAt: '2026-10-18T12:00:00.000Z', confidence: 3, notes: 'I need another example.' }); });
    await fx.service().reviewReflection(id); await began;
    const current = await fx.workspace().read('USER.md');
    await fx.workspace().write('USER.md', 'Confirmed correction: I prefer diagrams.', { expectedHash: current.hash, actor: 'user' });
    release(); await fx.service().settle();
    assert.match((await fx.workspace().read('USER.md')).content, /Confirmed correction/);
    const evidence = await fx.workspace().read(`memories/2026-10-18-${id}.md`);
    assert.match(evidence.content, new RegExp(`Evidence: reflection ${id}`));
    assert.match(evidence.content, /Tentative:/);
    assert.doesNotMatch(await personalizationInstructions(fx.workspace()), /Tentative: needs practice/);
    await fx.restart();
    assert.equal((await fx.store().readLearning()).runs.filter(run => run.kind === 'review').length, 1);
  } finally { release(); await fx.close(); }
});
