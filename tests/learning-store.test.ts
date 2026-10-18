import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { exercises, modules } from '../shared/curriculum.js';
import { ORIGINAL_CURRICULUM_ID, StateStore } from '../server/state.js';

const dirs: string[] = [];
after(() => { dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); });
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ari-learning-store-'));
  dirs.push(dir);
  return join(dir, 'state.sqlite');
};
const now = '2026-10-14T12:00:00.000Z';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const image = `data:image/png;base64,${png.toString('base64')}`;
const response = { kind: 'hint' as const, observation: '', feedback: 'A recorded hint.', nextStep: '', question: '', score: null, criteria: [], readable: true, confidence: 'high' as const };

test('new installations start with a generic learner profile and retain the original course as an option', async () => {
  const store = new StateStore(fixture());
  assert.equal((await store.read()).profile.name, 'Learner');
  assert(!(await store.read()).profile.goal.includes('prépa'));
  assert.equal((await store.readLearning()).curricula[0].id, ORIGINAL_CURRICULUM_ID);
  assert((await store.readLearning()).memory.content.includes('Name: Learner'));
  store.close();
});

test('bundled primer expansion retains history and work, skips personalized primers, and runs only once', async () => {
  const path = fixture();
  const oldPrimer = "Ohm's law is $V=IR$. At a junction, incoming current equals outgoing current. Around a closed loop, voltage rises and drops sum to zero. These are linear equations in unknown branch or mesh currents. Define current directions before writing equations; a negative solution would mean the actual flow is opposite the chosen direction.";
  const first = new StateStore(path);
  let photo = '';
  await first.update(state => {
    photo = first.saveSnapshot(image);
    state.progress[exercises[0].id] = { exerciseId: exercises[0].id, status: 'completed', confidence: 4, updatedAt: now, hintCount: 0, lastScore: 100, nextReviewAt: null };
    state.sessions.push({ id: 'preserved-session', exerciseId: exercises[0].id, createdAt: now, mode: 'chat', requestText: 'My work', response, snapshotId: photo });
  });
  await first.updateLearning(data => {
    data.lessons.find(lesson => lesson.id === 'circuits')!.primer = oldPrimer;
    data.lessons.find(lesson => lesson.id === 'functions')!.primer = 'A personalized explanation worth keeping.';
  });
  const before = await first.readLearning(); const work = await first.read(); first.close();
  const reopened = new StateStore(path);
  const after = await reopened.readLearning();
  const oldLesson = before.lessons.find(lesson => lesson.id === 'circuits')!;
  const newLesson = after.lessons.find(lesson => lesson.id === 'circuits')!;
  assert.deepEqual(newLesson, { ...oldLesson, primer: modules.find(module => module.id === 'circuits')!.primer, revision: oldLesson.revision + 1 });
  assert.deepEqual(after, { ...before, lessons: before.lessons.map(lesson => lesson.id === 'circuits' ? newLesson : lesson) });
  assert.deepEqual(await reopened.read(), work);
  assert.deepEqual(reopened.getSnapshot(photo), { data: png, mimeType: 'image/png' });
  const history = await reopened.readLessonRevisions('circuits');
  assert.ok(history.some(revision => revision.lesson.primer === oldPrimer));
  assert.equal(history.at(-1)!.lesson.primer, newLesson.primer);
  reopened.close();
  const again = new StateStore(path);
  assert.deepEqual(await again.readLearning(), after);
  assert.deepEqual(await again.readLessonRevisions('circuits'), history);
  again.close();
});

test('v4 migration preserves every old row and photo byte, seeding actual profile and stable course IDs', async () => {
  const path = fixture();
  const first = new StateStore(path);
  let photo = '';
  await first.update(state => {
    state.profile.name = 'Saved learner'; state.profile.goal = 'My actual saved goal';
    photo = first.saveSnapshot(image);
    state.progress[exercises[0].id] = { exerciseId: exercises[0].id, status: 'completed', confidence: 4, updatedAt: now, hintCount: 1, lastScore: 80, nextReviewAt: null };
    state.sessions.push({ id: 'session', createdAt: now, exerciseId: exercises[0].id, mode: 'chat', requestText: 'A saved question', response, snapshotId: photo });
    state.reflections.push({ id: 'reflection', createdAt: now, exerciseId: exercises[0].id, confidence: 4, notes: 'Saved reflection', snapshotIds: [photo] });
    state.exercisePages.push({ id: 'page', exerciseId: exercises[0].id, createdAt: now, snapshotId: photo });
    state.lessonSessions.push({ id: '53483282-7947-48a5-a88b-2ebc21c890d4', moduleId: modules[0].id, createdAt: now, requestText: 'Explain the lesson', response });
    state.generatedExercises.push({ ...exercises[0], id: 'saved-generated', generated: true });
    state.plan = { title: 'Saved plan', summary: 'Existing plan', adjustment: '', weeks: [{ week: 1, focus: 'Algebra', moduleIds: [modules[0].id], sessions: [] }] };
    state.dailyReviews.push({ id: 'review', date: '2026-10-14', timeZone: 'UTC', createdAt: now, evidenceFingerprint: 'actual', summary: 'Recorded summary', strengths: [], gaps: [], nextSteps: [], memories: [], recommendedModuleIds: [], pace: 'continue', evidenceSessionIds: ['session'], evidenceReflectionIds: ['reflection'] });
  });
  const beforeState = await first.read();
  first.close();
  const old = new DatabaseSync(path);
  old.exec("DROP TABLE learning_state; DROP TABLE learning_lesson_revisions; DROP TABLE learning_memory_revisions; UPDATE metadata SET value = '3' WHERE key = 'schema_version'");
  const tables = ['profile', 'progress', 'sessions', 'generated_exercises', 'plan', 'reflections', 'daily_reviews', 'exercise_pages', 'lesson_sessions', 'snapshots'];
  const rows = Object.fromEntries(tables.map(table => [table, old.prepare(`SELECT * FROM ${table}`).all()]));
  old.close();
  const migrated = new StateStore(path);
  assert.deepEqual(await migrated.read(), beforeState);
  assert.deepEqual(migrated.getSnapshot(photo), { data: png, mimeType: 'image/png' });
  const learning = await migrated.readLearning();
  assert.equal(learning.curricula[0].id, ORIGINAL_CURRICULUM_ID);
  assert.deepEqual(learning.lessons.map(lesson => lesson.id), modules.map(module => module.id));
  assert.deepEqual(learning.exercises, [...exercises, beforeState.generatedExercises[0]]);
  assert(learning.lessons[0].exerciseIds.includes('saved-generated'));
  assert(learning.memory.content.includes('Saved learner'));
  assert(learning.memory.content.includes('My actual saved goal'));
  assert.deepEqual(learning.messages, []);
  assert.deepEqual(learning.events, []);
  assert.deepEqual(learning.runs, []);
  assert.deepEqual(learning.reviewedEvidenceIds, ['reflection'], 'migration does not schedule an unsolicited review backlog');
  migrated.close();
  const db = new DatabaseSync(path);
  for (const table of tables) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), rows[table], table);
  assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value, '4');
  db.close();
});

test('failed migration rolls back new tables and schema version without rewriting old content', () => {
  const path = fixture();
  const store = new StateStore(path); store.close();
  const db = new DatabaseSync(path);
  db.exec("DROP TABLE learning_state; DROP TABLE learning_lesson_revisions; DROP TABLE learning_memory_revisions; UPDATE metadata SET value = '3' WHERE key = 'schema_version'; UPDATE profile SET payload = '{}'");
  db.close();
  assert.throws(() => new StateStore(path));
  const reopened = new DatabaseSync(path);
  assert.equal(reopened.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value, '3');
  assert.equal(reopened.prepare('SELECT payload FROM profile').get()?.payload, '{}');
  assert.equal(reopened.prepare("SELECT name FROM sqlite_master WHERE name = 'learning_state'").get(), undefined);
  reopened.close();
});

test('provider context and tool events roundtrip losslessly across connections, reloads and old updates', async () => {
  const path = fixture();
  const first = new StateStore(path);
  const second = new StateStore(path);
  const context = [
    { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [], future: { nested: [null, 5, false, '  exact text\n'] } },
    { type: 'function_call', call_id: 'call_1', name: 'inspect', arguments: '{"lessonId":"functions"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'result' },
    { type: 'compaction', encrypted_content: 'retain provider field', arbitrary: ['future', { number: 42 }] },
  ];
  await first.updateLearning(data => {
    data.context = context; data.contextTokens = 1234;
    data.messages.push({ id: 'main-1', role: 'user', content: '  preserved message\n', createdAt: now, status: 'complete', curriculumId: ORIGINAL_CURRICULUM_ID });
    data.runs.push({ id: 'run-1', requestId: 'request-1', kind: 'chat', status: 'running', createdAt: now, updatedAt: now });
    data.events.push({ id: 'event-1', runId: 'run-1', type: 'tool_call', createdAt: now, data: { arbitrary: { future: [1, null] } } });
  });
  await second.update(state => { state.profile.goal = 'Changed by the existing app'; });
  await second.updateLearning(data => { data.reviewedEvidenceIds.push('actual-evidence'); });
  first.close(); second.close();
  const reopened = new StateStore(path);
  const learning = await reopened.readLearning();
  assert.deepEqual(learning.context, context);
  assert.equal(learning.messages[0].content, '  preserved message\n');
  assert.deepEqual(learning.events[0].data, { arbitrary: { future: [1, null] } });
  assert.deepEqual(learning.reviewedEvidenceIds, ['actual-evidence']);
  assert.equal(learning.runs[0].status, 'running', 'restart recovery belongs to the runtime');
  assert.equal((await reopened.read()).profile.goal, 'Changed by the existing app');
  reopened.close();
});

test('learner state and revision histories are isolated by identity', async () => {
  const path = fixture();
  const first = new StateStore(path, { learnerId: 'learner-a' });
  const second = new StateStore(path, { learnerId: 'learner-b' });
  await first.updateLearning(data => { data.memory.content = 'Private learner A'; data.lessons[0].primer = 'Learner A lesson revision'; });
  assert.equal((await first.readLearning()).memory.content, 'Private learner A');
  assert(!(await second.readLearning()).memory.content.includes('Private learner A'));
  assert.equal((await first.readMemoryRevisions()).length, 2);
  assert.equal((await second.readMemoryRevisions()).length, 1);
  assert.equal((await first.readLessonRevisions(modules[0].id)).length, 2);
  assert.equal((await second.readLessonRevisions(modules[0].id)).length, 1);
  await assert.rejects(first.updateLearning(data => { data.learnerId = 'learner-b'; }), /different learner/);
  await assert.rejects(first.updateLearning(data => { data.curricula[0].learnerId = 'learner-b'; }), /different learner/);
  first.close(); second.close();
});

test('lesson content and exercise revisions retain the exact previous content, while status changes do not create content revisions', async () => {
  const store = new StateStore(fixture());
  const before = await store.readLearning();
  await store.updateLearning(data => { data.lessons[0].status = 'preparing'; });
  assert.equal((await store.readLessonRevisions(modules[0].id)).length, 1);
  await store.updateLearning(data => {
    data.lessons[0].primer = 'A newly adapted primer';
    data.exercises.find(exercise => exercise.id === modules[0].exerciseIds[0])!.prompt = 'A newly adapted practice prompt';
  });
  const revisions = await store.readLessonRevisions(modules[0].id);
  assert.equal(revisions.length, 2);
  assert.deepEqual(revisions[0].lesson, before.lessons[0]);
  assert.deepEqual(revisions[0].exercises, before.exercises.filter(exercise => before.lessons[0].exerciseIds.includes(exercise.id)));
  assert.equal(revisions[1].lesson.revision, 2);
  assert.equal(revisions[1].lesson.primer, 'A newly adapted primer');
  await store.updateLearning(data => { data.memory.content = 'Learner corrected this observation'; data.memory.updatedBy = 'user'; });
  const memories = await store.readMemoryRevisions();
  assert.equal(memories.length, 2);
  assert.deepEqual(memories[0], before.memory);
  assert.equal(memories[1].revision, 2);
  await assert.rejects(store.updateLearning(data => { data.lessons[0].revision = 1; }), /backwards/);
  store.close();
});

test('invalid and failed updates roll back learning data, history and snapshots', async () => {
  const store = new StateStore(fixture());
  const before = await store.readLearning();
  let snapshot = '';
  await assert.rejects(store.updateLearning(data => {
    snapshot = store.saveSnapshot(image);
    data.memory.content = 'Never committed';
    throw new Error('abort transaction');
  }), /abort transaction/);
  assert.equal(store.getSnapshot(snapshot), null);
  await assert.rejects(store.updateLearning(data => { data.messages.push({ id: 'bad', role: 'user', content: 'x'.repeat(100001), createdAt: now, status: 'complete' }); }));
  await assert.rejects(store.updateLearning(data => { data.context = [{ invalid: undefined }]; }), /lossless JSON/);
  await assert.rejects(store.updateLearning(data => { data.context = [{ invalid: Infinity }]; }), /lossless JSON/);
  await assert.rejects(store.updateLearning(async data => { data.memory.content = 'Async must not commit'; }), /synchronous/);
  assert.deepEqual(await store.readLearning(), before);
  assert.equal((await store.readMemoryRevisions()).length, 1);
  assert.equal((await store.readLessonRevisions(modules[0].id)).length, 1);
  store.close();
});

test('generic curricula retain supplied PDF originals and reject references across curricula', async () => {
  const path = fixture();
  const store = new StateStore(path);
  const pdf = 'data:application/pdf;base64,JVBERi0xLjcK';
  await store.updateLearning(data => {
    data.curricula.push({ id: 'ethics', learnerId: data.learnerId, title: 'Practical ethics', description: 'Reason about ethical cases', topic: 'Philosophy', level: 'Starting out', goal: 'Evaluate arguments', lessonIds: ['ethical-arguments'], createdAt: now, updatedAt: now, source: 'generated' });
    data.lessons.push({ id: 'ethical-arguments', curriculumId: 'ethics', subject: 'philosophy', title: 'Evaluating arguments', frenchTitle: '', phase: 1, summary: 'Identify premises', primer: 'A premise supports a conclusion.', objectives: ['Identify a premise'], prerequisites: [], exerciseIds: [], resources: [], status: 'planned', revision: 1 });
    data.materials.push({ id: 'pdf-one', title: 'Supplied reading', kind: 'pdf', createdAt: now, text: 'Extracted text with a source page.', filename: 'reading.pdf', sourceData: pdf });
  });
  await assert.rejects(store.updateLearning(data => {
    data.lessons.find(lesson => lesson.id === 'ethical-arguments')!.prerequisites.push(modules[0].id);
  }), /Prerequisites/);
  await assert.rejects(store.updateLearning(data => {
    data.lessons.find(lesson => lesson.id === 'ethical-arguments')!.exerciseIds.push(exercises[0].id);
  }), /own unique exercises/);
  store.close();
  const reopened = new StateStore(path);
  assert.equal((await reopened.readLearning()).materials[0].sourceData, pdf);
  assert.equal((await reopened.readLearning()).lessons.find(lesson => lesson.id === 'ethical-arguments')!.subject, 'philosophy');
  reopened.close();
});
