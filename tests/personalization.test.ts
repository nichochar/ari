import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { PersonalizationError, PersonalizationWorkspace } from '../server/personalization.js';
import { StateStore } from '../server/state.js';

const directories: string[] = [];
const stores: StateStore[] = [];
after(() => { for (const store of stores) store.close(); for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ari-personalization-test-'));
  directories.push(directory);
  const dbPath = join(directory, 'state.sqlite');
  const rootPath = join(directory, 'notes');
  const store = new StateStore(dbPath);
  stores.push(store);
  return { directory, rootPath, dbPath, store, workspace: new PersonalizationWorkspace(store, rootPath) };
}
const code = (expected: PersonalizationError['code']) => (error: unknown) => error instanceof PersonalizationError && error.code === expected;

test('fresh learner receives private Markdown documents, bounded reads, search and persisted edits', async () => {
  const { workspace, rootPath, store } = fixture();
  const initial = await workspace.view();
  assert.equal(initial.onboarding.status, 'new');
  assert.equal(initial.files.length, 2);
  assert.match(initial.user.content, /Name: Learner/);
  assert.doesNotMatch(initial.user.content, /Earlier learning notes|memories\/imported/);
  assert.match(initial.tutor.content, /Never invent personal facts/);
  assert.equal(statSync(rootPath).mode & 0o777, 0o700);
  assert.equal(statSync(join(rootPath, 'USER.md')).mode & 0o777, 0o600);
  const doc = await workspace.write('memories/observations/algebra.md', '# Algebra\nUses a diagram.\nDiagram helps.\n', { expectedHash: null, actor: 'ari', reason: 'Exercise evidence.' });
  assert.equal(doc.revision, 1);
  assert.equal(readFileSync(join(rootPath, doc.path), 'utf8'), doc.content);
  const partial = await workspace.read(doc.path, 2, 7);
  assert.equal(partial.content, doc.content.slice(2, 9));
  assert.equal(partial.hash, doc.hash);
  assert.equal(partial.total, doc.content.length);
  assert.equal(partial.truncated, true);
  const search = await workspace.search('diagram', 'memories', 1);
  assert.deepEqual(search.matches, [{ path: doc.path, line: 2, text: 'Uses a diagram.' }]);
  assert.equal(search.truncated, true);
  const list = await workspace.list('', 0, 1);
  assert.equal(list.files.length, 1);
  assert.equal(list.total, 3);
  assert.equal(list.truncated, true);
  const edited = await workspace.edit(doc.path, 'Uses a diagram.', 'Draws a graph.', { expectedHash: doc.hash, actor: 'user' });
  assert.equal(edited.revision, 2);
  assert.equal((await new PersonalizationWorkspace(store, rootPath).read(doc.path)).content, edited.content);
});

test('migration preserves learning records, verbatim memory, evidence IDs/dates and existing Markdown', async () => {
  const { workspace, rootPath, store } = fixture();
  const now = '2026-10-11T12:00:00.000Z';
  await store.update(state => {
    state.profile.name = 'Synthetic learner';
    state.profile.goal = 'Learn botany';
    state.reflections.push({ id: 'reflection-evidence', exerciseId: 'botany-1', createdAt: now, confidence: 3, notes: 'Try a labelled diagram.', snapshotId: 'photo-private' });
    state.dailyReviews.push({ id: 'review-evidence', date: '2026-10-11', timeZone: 'America/Los_Angeles', createdAt: now, evidenceFingerprint: 'fingerprint', summary: 'Practised diagrams.', strengths: ['Observation'], gaps: ['Vocabulary'], nextSteps: ['Name leaf parts'], memories: ['Learner requested diagrams'], recommendedModuleIds: [], pace: 'continue', evidenceSessionIds: ['session-evidence'], evidenceReflectionIds: ['reflection-evidence'] });
  });
  const legacyContent = '# Original notes\n\nKeep *formatting* exactly.\n\n';
  await store.updateLearning(data => { data.memory.content = legacyContent; });
  mkdirSync(join(rootPath, 'memories', 'imported'), { recursive: true });
  writeFileSync(join(rootPath, 'TUTOR.md'), '# Custom tutor\n');
  writeFileSync(join(rootPath, 'memories', 'imported', 'learner-notes.md'), '# Already present\n');
  const beforeState = await store.read();
  const beforeLearning = await store.readLearning();
  const beforeMemoryHistory = await store.readMemoryRevisions();
  const view = await workspace.view();
  assert.equal(view.onboarding.status, 'imported');
  assert.equal(view.tutor.content, '# Custom tutor\n');
  assert.match(view.user.content, /Synthetic learner/);
  assert.match(view.user.content, /Learn botany/);
  assert.equal((await workspace.read('memories/imported/learner-notes.md')).content, '# Already present\n');
  const exported = view.files.filter(file => file.path.startsWith('memories/imported/learner-notes-import-'));
  assert.equal(exported.length, 1);
  assert.equal((await workspace.read(exported[0].path)).content, legacyContent);
  assert.ok(view.user.content.includes(exported[0].path));
  assert.doesNotMatch(view.user.content, /Keep \*formatting\* exactly/);
  const review = await workspace.read(view.files.find(file => file.path.startsWith('memories/reviews/'))!.path);
  assert.match(review.content, /2026-10-11/);
  assert.match(review.content, /America\/Los_Angeles/);
  assert.match(review.content, /session-evidence/);
  assert.match(review.content, /reflection-evidence/);
  const reflection = await workspace.read(view.files.find(file => file.path.startsWith('memories/reflections/'))!.path);
  assert.match(reflection.content, /Try a labelled diagram/);
  assert.doesNotMatch(reflection.content, /photo-private/);
  assert.deepEqual(await store.read(), beforeState);
  assert.deepEqual(await store.readLearning(), beforeLearning);
  assert.deepEqual(await store.readMemoryRevisions(), beforeMemoryHistory);
  const reopened = await new PersonalizationWorkspace(store, rootPath).view();
  assert.deepEqual(reopened, view);
});

test('direct disk edits and deletions become historical revisions and stale updates fail', async () => {
  const { workspace, rootPath } = fixture();
  const original = await workspace.read('USER.md');
  writeFileSync(join(rootPath, 'USER.md'), '# Edited in a text editor\n');
  await assert.rejects(workspace.write('USER.md', '# Stale replacement', { expectedHash: original.hash, actor: 'user' }), code('conflict'));
  const external = await workspace.read('USER.md');
  assert.equal(external.actor, 'external');
  assert.equal(external.revision, original.revision + 1);
  assert.equal(external.content, '# Edited in a text editor\n');
  const restored = await workspace.restore('USER.md', original.revision, { expectedHash: external.hash, actor: 'user' });
  assert.equal(restored.content, original.content);
  assert.equal(restored.revision, external.revision + 1);
  assert.deepEqual((await workspace.revisions('USER.md')).map(item => item.revision), [3, 2, 1]);
  unlinkSync(join(rootPath, 'USER.md'));
  await assert.rejects(workspace.read('USER.md'), code('not_found'));
  const missingHistory = await workspace.revisions('USER.md');
  assert.equal(missingHistory[0].deleted, true);
  assert.equal((await workspace.restore('USER.md', original.revision, { expectedHash: null, actor: 'user' })).content, original.content);
});

test('existing core notes retain their corrections and gain only an imported-memory discovery pointer', async () => {
  const { workspace, rootPath, store } = fixture();
  await store.updateLearning(data => { data.memory.content = 'Archived tentative observation'; });
  mkdirSync(rootPath, { recursive: true });
  const original = '# Learner\n\nConfirmed correction: give visual explanations.\n';
  writeFileSync(join(rootPath, 'USER.md'), original);
  const view = await workspace.view();
  assert.ok(view.user.content.startsWith(original));
  assert.match(view.user.content, /memories\/imported\/learner-notes\.md/);
  assert.doesNotMatch(view.user.content, /Archived tentative observation/);
  assert.equal((await workspace.revisions('USER.md')).length, 2);
  assert.equal((await new PersonalizationWorkspace(store, rootPath).view()).user.hash, view.user.hash);
});

test('routine core views and onboarding completion do not read unrelated memory files', async () => {
  const { workspace, rootPath, directory } = fixture();
  await workspace.ready();
  mkdirSync(join(rootPath, 'memories'), { recursive: true });
  writeFileSync(join(directory, 'outside.md'), 'Unrelated external file');
  symlinkSync(join(directory, 'outside.md'), join(rootPath, 'memories', 'linked.md'));
  const core = await workspace.coreView();
  assert.equal(core.files.length, 0);
  assert.match(core.user.content, /Name: Learner/);
  assert.equal((await workspace.completeOnboarding()).onboarding.status, 'complete');
  await assert.rejects(workspace.view(), code('invalid_path'));
});

test('a failed migration can retry after correcting its files without restarting or losing history', async () => {
  const { workspace, rootPath } = fixture();
  mkdirSync(rootPath, { recursive: true });
  writeFileSync(join(rootPath, 'USER.md'), 'x'.repeat(12001));
  await assert.rejects(workspace.ready(), code('too_large'));
  writeFileSync(join(rootPath, 'USER.md'), '# Corrected learner notes\n');
  await workspace.ready();
  assert.equal((await workspace.read('USER.md')).content, '# Corrected learner notes\n');
  assert.equal((await workspace.revisions('TUTOR.md')).length, 1);
});

test('serialized competing saves preserve one winner and never overwrite conflicting destinations', async () => {
  const { workspace, rootPath } = fixture();
  const original = await workspace.write('memories/one.md', 'Original', { actor: 'user', expectedHash: null });
  const attempts = await Promise.allSettled([
    workspace.write(original.path, 'First change', { actor: 'ari', expectedHash: original.hash }),
    workspace.write(original.path, 'Second change', { actor: 'user', expectedHash: original.hash }),
  ]);
  assert.equal(attempts[0].status, 'fulfilled');
  assert.equal(attempts[1].status, 'rejected');
  const current = await workspace.read(original.path);
  assert.equal(current.content, 'First change');
  await workspace.write('memories/two.md', 'Destination', { actor: 'user', expectedHash: null });
  await assert.rejects(workspace.move(original.path, 'memories/two.md', { actor: 'user', expectedHash: current.hash }), code('conflict'));
  assert.equal((await workspace.read('memories/two.md')).content, 'Destination');
  const moved = await workspace.move(original.path, 'memories/archive/one.md', { actor: 'user', expectedHash: current.hash });
  assert.equal(moved.content, current.content);
  assert.equal(existsSync(join(rootPath, original.path)), false);
  await workspace.delete(moved.path, { actor: 'user', expectedHash: moved.hash });
  assert.equal((await workspace.revisions(moved.path))[0].deleted, true);
  assert.equal((await workspace.restore(moved.path, 1, { actor: 'user', expectedHash: null })).content, current.content);
});

test('path containment rejects traversal, hidden/unsafe files, absolute paths and symbolic links', async () => {
  const { workspace, rootPath, directory } = fixture();
  await workspace.ready();
  for (const path of ['../outside.md', '/tmp/outside.md', 'memories/../../outside.md', 'memories/.hidden.md', 'memories/file.txt', 'memories/file.md/', 'OTHER.md', 'memories/dir/../file.md', 'memories\\file.md']) {
    await assert.rejects(workspace.write(path, 'Forbidden', { actor: 'user', expectedHash: null }), code('invalid_path'));
  }
  const outside = join(directory, 'outside.md');
  writeFileSync(outside, 'Outside content');
  mkdirSync(join(rootPath, 'memories'), { recursive: true });
  symlinkSync(outside, join(rootPath, 'memories', 'link.md'));
  await assert.rejects(workspace.read('memories/link.md'), code('invalid_path'));
  await assert.rejects(workspace.write('memories/link.md', 'Changed', { actor: 'user', expectedHash: null }), code('invalid_path'));
  await assert.rejects(workspace.list('memories'), code('invalid_path'));
  unlinkSync(join(rootPath, 'memories', 'link.md'));
  symlinkSync(directory, join(rootPath, 'memories', 'linked-directory'));
  await assert.rejects(workspace.read('memories/linked-directory/outside.md'), code('invalid_path'));
  assert.equal(readFileSync(outside, 'utf8'), 'Outside content');
  symlinkSync(rootPath, join(directory, 'root-link'));
  await assert.rejects(new PersonalizationWorkspace(fixture().store, join(directory, 'root-link')).ready(), code('invalid_path'));
});

test('database/workspace binding prevents previews adopting or switching private learner files', async () => {
  const first = fixture();
  await first.workspace.ready();
  const second = fixture();
  await assert.rejects(new PersonalizationWorkspace(second.store, first.rootPath).ready(), code('workspace_mismatch'));
  await assert.rejects(new PersonalizationWorkspace(first.store, second.rootPath).ready(), code('workspace_mismatch'));
  assert.equal(second.store.readPersonalizationMetadata(), null);
  await second.workspace.ready();
  assert.notEqual(first.store.readPersonalizationMetadata()!.workspaceId, second.store.readPersonalizationMetadata()!.workspaceId);
  assert.equal((await second.workspace.onboarding()).status, 'new');
});

test('onboarding persists skip/complete/revisit and retains existing notes with optimistic hashes', async () => {
  const { workspace, store, rootPath } = fixture();
  assert.equal((await workspace.skipOnboarding()).status, 'skipped');
  assert.equal((await new PersonalizationWorkspace(store, rootPath).onboarding()).status, 'skipped');
  assert.equal((await workspace.beginOnboarding()).status, 'new');
  const before = await workspace.view();
  await assert.rejects(workspace.completeOnboarding({ goals: 'Botany', expectedUserHash: '0'.repeat(64) }), code('conflict'));
  assert.equal((await workspace.read('USER.md')).content, before.user.content);
  const completed = await workspace.completeOnboarding({ name: 'Alex', goals: 'Understand leaves', startingLevel: 'Beginner', learningPreferences: 'Use diagrams', tutorStyle: 'Ask one question at a time', boundaries: 'Avoid timed work', expectedUserHash: before.user.hash, expectedTutorHash: before.tutor.hash });
  assert.equal(completed.onboarding.status, 'complete');
  assert.ok(completed.user.content.startsWith(before.user.content));
  assert.match(completed.user.content, /Understand leaves/);
  assert.match(completed.tutor.content, /Ask one question at a time/);
  await workspace.beginOnboarding();
  const finalized = await workspace.completeOnboarding();
  assert.equal(finalized.user.content, completed.user.content);
  assert.equal(finalized.tutor.content, completed.tutor.content);
  assert.equal(finalized.onboarding.status, 'complete');
});

test('size bounds and ambiguous edits fail without altering documents', async () => {
  const { workspace } = fixture();
  const core = await workspace.read('TUTOR.md');
  await assert.rejects(workspace.write(core.path, 'x'.repeat(12001), { expectedHash: core.hash, actor: 'user' }), code('too_large'));
  await assert.rejects(workspace.write('memories/huge.md', 'x'.repeat(64001), { expectedHash: null, actor: 'ari' }), code('too_large'));
  const doc = await workspace.write('memories/repeated.md', 'Repeat. Repeat.', { expectedHash: null, actor: 'user' });
  await assert.rejects(workspace.edit(doc.path, 'Repeat', 'Unique', { expectedHash: doc.hash, actor: 'user' }), code('conflict'));
  await assert.rejects(workspace.move(core.path, 'memories/moved.md', { expectedHash: core.hash, actor: 'user' }), code('invalid_path'));
  await assert.rejects(workspace.delete('TUTOR.md', { expectedHash: core.hash, actor: 'user' }), code('invalid_path'));
  assert.equal((await workspace.read(core.path)).hash, core.hash);
  assert.equal((await workspace.read(doc.path)).hash, doc.hash);
});
