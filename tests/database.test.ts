import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { exercises } from '../shared/curriculum.js';
import type { AppState } from '../shared/types.js';
import { defaultState, StateStore } from '../server/state.js';

const tempDirs: string[] = [];
after(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ari-db-test-'));
  tempDirs.push(dir);
  return { dbPath: join(dir, 'state.sqlite'), legacyPath: join(dir, 'state.json') };
};

const timestamp = '2026-10-11T12:00:00.000Z';
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const pngUrl = `data:image/png;base64,${png.toString('base64')}`;

function filledState(): AppState {
  return {
    ...defaultState(),
    profile: { ...defaultState().profile, name: 'Legacy Alex' },
    progress: { 'sensor-calibration': { exerciseId: 'sensor-calibration', status: 'started', confidence: 3, updatedAt: timestamp, hintCount: 1, lastScore: null, nextReviewAt: null } },
    sessions: [{ id: 'session-one', createdAt: timestamp, exerciseId: 'sensor-calibration', mode: 'hint', requestText: 'First hint', response: { kind: 'hint', observation: '', feedback: '', nextStep: 'Find the slope.', question: '', score: null, criteria: [], readable: true, confidence: 'high' } }],
    generatedExercises: [{ ...exercises[0], id: 'generated-one', generated: true }],
    plan: { title: 'Four weeks', summary: 'Review algebra', adjustment: 'Start gently', weeks: [{ week: 1, focus: 'Functions', moduleIds: ['functions'], sessions: [{ title: 'Calibration', moduleId: 'functions', exerciseId: 'sensor-calibration', minutes: 25 }] }] },
    reflections: [{ id: 'reflection-one', exerciseId: 'sensor-calibration', createdAt: timestamp, confidence: 3, notes: 'Need more practice.' }],
    dailyReviews: [{ id: 'review-one', date: '2026-10-11', timeZone: 'America/Los_Angeles', createdAt: timestamp, evidenceFingerprint: 'abc', summary: 'Good start.', strengths: ['Set up the slope'], gaps: ['Units'], nextSteps: ['Check dimensions'], memories: ['Prefers short hints'], recommendedModuleIds: ['functions'], pace: 'continue', evidenceSessionIds: ['session-one'], evidenceReflectionIds: ['reflection-one'] }],
  };
}

test('migrates every legacy record once and preserves both source and backup', async () => {
  const { dbPath, legacyPath } = fixture();
  const original = filledState();
  const raw = JSON.stringify(original, null, 2);
  writeFileSync(legacyPath, raw);
  const store = new StateStore(dbPath, { legacyPath });
  assert.deepEqual(await store.read(), original);
  store.close();
  assert.equal(readFileSync(legacyPath, 'utf8'), raw);
  assert.equal(readFileSync(`${legacyPath}.backup`, 'utf8'), raw);

  const db = new DatabaseSync(dbPath);
  for (const table of ['profile', 'progress', 'sessions', 'generated_exercises', 'plan', 'reflections', 'daily_reviews']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, 1, table);
  }
  db.close();
  writeFileSync(legacyPath, JSON.stringify(defaultState()));
  const reopened = new StateStore(dbPath, { legacyPath });
  assert.equal((await reopened.read()).profile.name, 'Legacy Alex');
  assert.equal(readFileSync(`${legacyPath}.backup`, 'utf8'), raw);
  reopened.close();
});

test('older legacy state receives empty reflection and review collections', async () => {
  const { dbPath, legacyPath } = fixture();
  const old = { ...filledState(), reflections: undefined, dailyReviews: undefined, lessonSessions: undefined };
  writeFileSync(legacyPath, JSON.stringify(old));
  const store = new StateStore(dbPath, { legacyPath });
  const state = await store.read();
  assert.deepEqual(state.reflections, []);
  assert.deepEqual(state.dailyReviews, []);
  assert.deepEqual(state.exercisePages, []);
  assert.deepEqual(state.lessonSessions, []);
  assert.equal(state.sessions.length, 1);
  store.close();
});

test('upgrades a version-one database in place and keeps legacy journal photos', async () => {
  const { dbPath } = fixture();
  const store = new StateStore(dbPath);
  let photoId = '';
  await store.update(state => {
    Object.assign(state, filledState());
    photoId = store.saveSnapshot(pngUrl);
    state.sessions[0].snapshotId = photoId;
    state.reflections[0].snapshotId = photoId;
  });
  store.close();
  const old = new DatabaseSync(dbPath);
  old.exec("DROP TABLE exercise_pages; DROP TABLE lesson_sessions; UPDATE metadata SET value = '1' WHERE key = 'schema_version'");
  old.close();
  const upgraded = new StateStore(dbPath);
  const state = await upgraded.read();
  assert.deepEqual(state.exercisePages, []);
  assert.deepEqual(state.lessonSessions, []);
  assert.equal(state.sessions[0].snapshotId, photoId);
  assert.equal(state.sessions[0].snapshotIds, undefined);
  assert.equal(state.reflections[0].snapshotId, photoId);
  assert.deepEqual(state.progress, filledState().progress);
  assert.deepEqual(state.generatedExercises, filledState().generatedExercises);
  assert.deepEqual(state.plan, filledState().plan);
  assert.deepEqual(state.dailyReviews, filledState().dailyReviews);
  assert.deepEqual(upgraded.getSnapshot(photoId), { data: png, mimeType: 'image/png' });
  upgraded.close();
  const db = new DatabaseSync(dbPath);
  assert.equal((db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string }).value, '4');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM exercise_pages').get() as { count: number }).count, 0);
  db.close();
});

test('malformed or invalid legacy JSON never erases its source or creates a usable state', () => {
  for (const raw of ['{broken', JSON.stringify({ profile: {} })]) {
    const { dbPath, legacyPath } = fixture();
    writeFileSync(legacyPath, raw);
    assert.throws(() => new StateStore(dbPath, { legacyPath }), /legacy state/i);
    assert.equal(readFileSync(legacyPath, 'utf8'), raw);
    assert.throws(() => readFileSync(`${legacyPath}.backup`, 'utf8'), /ENOENT/);
  }
});

test('unknown database and mismatched legacy backup stop migration without erasing files', () => {
  const foreign = fixture();
  const db = new DatabaseSync(foreign.dbPath);
  db.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'keep me\')');
  db.close();
  assert.throws(() => new StateStore(foreign.dbPath), /Unrecognized state database/);
  const reopened = new DatabaseSync(foreign.dbPath);
  assert.equal((reopened.prepare('SELECT value FROM unrelated').get() as { value: string }).value, 'keep me');
  reopened.close();

  const backedUp = fixture();
  const raw = JSON.stringify(defaultState());
  writeFileSync(backedUp.legacyPath, raw);
  writeFileSync(`${backedUp.legacyPath}.backup`, 'different data');
  assert.throws(() => new StateStore(backedUp.dbPath, { legacyPath: backedUp.legacyPath }), /backup.*differs/);
  assert.equal(readFileSync(backedUp.legacyPath, 'utf8'), raw);
  assert.equal(readFileSync(`${backedUp.legacyPath}.backup`, 'utf8'), 'different data');
});

test('reopens committed state and preserves updates from two connections', async () => {
  const { dbPath } = fixture();
  const first = new StateStore(dbPath);
  const second = new StateStore(dbPath);
  await first.update(state => { state.profile.name = 'Alex'; state.profile.sessionMinutes = 30; });
  await second.update(state => { state.profile.goal = 'Rebuild calculus'; });
  assert.equal((await first.read()).profile.goal, 'Rebuild calculus');
  await first.update(state => { state.profile.sessionsPerWeek = 5; });
  first.close();
  second.close();
  const reopened = new StateStore(dbPath);
  assert.deepEqual((await reopened.read()).profile, { name: 'Alex', language: 'en', sessionMinutes: 30, sessionsPerWeek: 5, goal: 'Rebuild calculus' });
  reopened.close();
});

test('profile updates leave unchanged entity rows alone and new database is private', async () => {
  const { dbPath } = fixture();
  const store = new StateStore(dbPath);
  assert.equal(statSync(dbPath).mode & 0o777, 0o600);
  await store.update(state => { state.sessions = filledState().sessions; });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE audit (event TEXT);
    CREATE TRIGGER session_updated AFTER UPDATE ON sessions BEGIN INSERT INTO audit VALUES ('updated'); END;
    CREATE TRIGGER session_deleted AFTER DELETE ON sessions BEGIN INSERT INTO audit VALUES ('deleted'); END;`);
  await store.update(state => { state.profile.sessionMinutes = 30; });
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM audit').get() as { count: number }).count, 0);
  db.close();
  store.close();
});

test('failed mutation and validation roll back records and inserted snapshots', async () => {
  const { dbPath } = fixture();
  const store = new StateStore(dbPath);
  let inserted = '';
  await assert.rejects(store.update(state => {
    inserted = store.saveSnapshot(pngUrl);
    state.profile.sessionMinutes = 40;
    throw new Error('stop');
  }), /stop/);
  assert.equal(store.getSnapshot(inserted), null);
  assert.equal((await store.read()).profile.sessionMinutes, 25);
  await assert.rejects(store.update(state => {
    inserted = store.saveSnapshot(pngUrl);
    state.profile.sessionMinutes = 999;
  }));
  assert.equal(store.getSnapshot(inserted), null);
  assert.equal((await store.read()).profile.sessionMinutes, 25);
  store.close();
});

test('snapshots are validated, deduplicated and stored as bytes outside AppState', async () => {
  const { dbPath } = fixture();
  const store = new StateStore(dbPath);
  let id = '';
  await store.update(state => {
    id = store.saveSnapshot(pngUrl);
    assert.equal(store.saveSnapshot(pngUrl), id);
    state.reflections.push({ id: 'r1', exerciseId: 'sensor-calibration', createdAt: timestamp, confidence: 4, notes: 'Diagram helped.', snapshotId: id });
  });
  assert.deepEqual(store.getSnapshot(id), { data: png, mimeType: 'image/png' });
  assert.equal(store.getSnapshot('missing'), null);
  assert.equal(JSON.stringify(await store.read()).includes(png.toString('base64')), false);
  await assert.rejects(store.update(() => { store.saveSnapshot('data:image/png;base64,AA=='); }), /does not match/);
  store.close();
  const reopened = new StateStore(dbPath);
  assert.deepEqual(reopened.getSnapshot(id), { data: png, mimeType: 'image/png' });
  assert.equal((await reopened.read()).reflections[0].snapshotId, id);
  reopened.close();
});

for (const version of ['1', '2']) {
  test(`schema ${version} to four preserves every existing row and snapshot byte, including old review payloads`, async () => {
    const { dbPath } = fixture();
    const store = new StateStore(dbPath);
    await store.update(state => {
      Object.assign(state, filledState());
      const snapshotId = store.saveSnapshot(pngUrl);
      state.sessions[0].snapshotId = snapshotId;
      state.reflections[0].snapshotId = snapshotId;
      if (version === '2') state.exercisePages.push({ id: 'page-one', exerciseId: 'sensor-calibration', createdAt: timestamp, snapshotId });
    });
    const beforeState = await store.read();
    store.close();
    const old = new DatabaseSync(dbPath);
    old.exec('DROP TABLE lesson_sessions');
    if (version === '1') old.exec('DROP TABLE exercise_pages');
    old.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(version);
    const tables = ['profile', 'progress', 'sessions', 'generated_exercises', 'plan', 'reflections', 'daily_reviews', 'snapshots', ...(version === '2' ? ['exercise_pages'] : [])];
    const rows = Object.fromEntries(tables.map(table => [table, old.prepare(`SELECT * FROM ${table}`).all()]));
    old.close();
    const upgraded = new StateStore(dbPath);
    assert.deepEqual(await upgraded.read(), beforeState);
    // Subsequent writes also must leave absent optional evidence fields absent on old reviews.
    await upgraded.update(state => { state.profile.goal = 'A new goal'; });
    upgraded.close();
    const migrated = new DatabaseSync(dbPath);
    for (const table of tables.filter(table => table !== 'profile'))
      assert.deepEqual(migrated.prepare(`SELECT * FROM ${table}`).all(), rows[table], table);
    assert.equal((migrated.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string }).value, '4');
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM lesson_sessions').get() as { count: number }).count, 0);
    assert.equal(JSON.parse((migrated.prepare('SELECT payload FROM daily_reviews').get() as { payload: string }).payload).evidenceLessonSessionIds, undefined);
    migrated.close();
  });
}
