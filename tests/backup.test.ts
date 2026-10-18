import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';

const directories: string[] = [];
after(() => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ari-backup-'));
  directories.push(dir);
  const path = join(dir, 'app.sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE snapshots (data BLOB); CREATE TABLE learning_state (payload TEXT)');
  const photo = Buffer.from('original learner photo bytes');
  db.prepare('INSERT INTO snapshots VALUES (?)').run(photo);
  return { dir, path, db, photo, out: join(dir, 'backups') };
}
function run(f: ReturnType<typeof fixture>) {
  return spawnSync(process.execPath, [resolve('scripts/backup.mjs')], {
    encoding: 'utf8', env: { ...process.env, ARI_DB_PATH: f.path, ARI_BACKUP_DIR: f.out }, timeout: 15_000,
  });
}
function databaseValue(path: string, query: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(query).get(); } finally { db.close(); }
}

test('legacy backup retains snapshot bytes from WAL and publishes only a private SQLite file', () => {
  const f = fixture();
  try {
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    const files = readdirSync(f.out);
    assert.equal(files.length, 1);
    assert.match(files[0], /^ari-.*\.sqlite$/);
    const path = join(f.out, files[0]);
    assert.deepEqual(Buffer.from(databaseValue(path, 'SELECT data FROM snapshots')!.data as Uint8Array), f.photo);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(f.out).mode & 0o777, 0o700);
  } finally { f.db.close(); }
});

test('combined backup preserves native SQLite WAL history and excludes credentials and diagnostics', () => {
  const f = fixture();
  const state = `${f.path}.codex/state`;
  mkdirSync(state, { recursive: true });
  const metadata = new DatabaseSync(join(state, 'state_5.sqlite'));
  const rollout = join(state, 'home/sessions/2026/10/14/rollout-saved.jsonl');
  metadata.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT)');
  metadata.prepare('INSERT INTO threads VALUES (?, ?)').run('saved', rollout);
  metadata.close();
  mkdirSync(join(state, 'home/sessions/2026/10/14'), { recursive: true });
  writeFileSync(rollout, 'canonical model context\n');
  writeFileSync(join(state, 'home/auth.json'), 'never copy credentials');
  writeFileSync(join(state, 'home/config.toml'), 'never copy global settings');
  const native = new DatabaseSync(join(state, 'thread_history_1.sqlite'));
  native.exec("PRAGMA journal_mode=WAL; CREATE TABLE history (text TEXT); INSERT INTO history VALUES ('persisted native turn')");
  f.db.prepare('INSERT INTO learning_state VALUES (?)').run(JSON.stringify({ context: [{ type: 'ari_codex_context', threadId: 'saved' }], runs: [] }));
  for (const name of ['auth.json', 'config.toml', 'logs_2.sqlite', 'unknown.sqlite']) writeFileSync(join(state, name), 'must not be copied');
  try {
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    const main = readdirSync(f.out).find(name => name.endsWith('.sqlite'))!;
    const companion = join(f.out, `${main}.codex`);
    assert.deepEqual(readdirSync(join(companion, 'state')), ['home', 'state_5.sqlite', 'thread_history_1.sqlite']);
    assert.deepEqual(readdirSync(join(companion, 'state/home')), ['sessions']);
    assert.equal(readFileSync(join(companion, 'state/home/sessions/2026/10/14/rollout-saved.jsonl'), 'utf8'), 'canonical model context\n');
    assert.equal(databaseValue(join(companion, 'state/thread_history_1.sqlite'), 'SELECT text FROM history')!.text, 'persisted native turn');
    assert.equal(statSync(companion).mode & 0o777, 0o700);
    assert.equal(statSync(join(companion, 'state/state_5.sqlite')).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(join(companion, 'backup.json'), 'utf8')).sourceRuntime, `${f.path}.codex`);
    assert.deepEqual(readdirSync(join(companion, 'workspace')), []);
  } finally { native.close(); f.db.close(); }
});

test('queued or running native work defers backup without artifacts or changing learner data', () => {
  const f = fixture();
  mkdirSync(`${f.path}.codex/state`, { recursive: true });
  try {
    for (const status of ['queued', 'running']) {
      const payload = JSON.stringify({ runs: [{ status }], context: [] });
      f.db.prepare('INSERT INTO learning_state VALUES (?)').run(payload);
      const result = run(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Retry after it finishes/);
      assert.equal(f.db.prepare('SELECT payload FROM learning_state').get()!.payload, payload);
      assert.equal(readdirSync(f.dir).includes('backups'), false);
      f.db.prepare('DELETE FROM learning_state').run(); // The guard transaction was released.
    }
  } finally { f.db.close(); }
});

test('missing native history and linked native databases refuse incomplete or external backups', () => {
  const f = fixture();
  f.db.prepare('INSERT INTO learning_state VALUES (?)').run(JSON.stringify({ runs: [], context: [{ type: 'ari_codex_context', threadId: 'saved' }] }));
  try {
    assert.match(run(f).stderr, /refusing an incomplete backup/);
    mkdirSync(`${f.path}.codex/state`, { recursive: true });
    symlinkSync(f.path, `${f.path}.codex/state/state_5.sqlite`);
    assert.match(run(f).stderr, /not a link/);
    assert.deepEqual(readdirSync(f.out), []);
  } finally { f.db.close(); }
});

test('global desktop rollout references refuse backup without copying external content', () => {
  const f = fixture();
  mkdirSync(`${f.path}.codex/state`, { recursive: true });
  const native = new DatabaseSync(`${f.path}.codex/state/state_5.sqlite`);
  native.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT)');
  native.prepare('INSERT INTO threads VALUES (?, ?)').run('desktop-thread', join(f.dir, 'global/sessions/rollout-desktop.jsonl'));
  native.close();
  try {
    assert.match(run(f).stderr, /refusing to copy unrelated desktop history/);
    assert.deepEqual(readdirSync(f.out), []);
  } finally { f.db.close(); }
});

test('missing or linked canonical rollouts refuse a partial native backup', () => {
  const f = fixture();
  const state = `${f.path}.codex/state`;
  mkdirSync(join(state, 'home/sessions'), { recursive: true });
  const rollout = join(state, 'home/sessions/rollout-saved.jsonl');
  const native = new DatabaseSync(join(state, 'state_5.sqlite'));
  native.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT)');
  native.prepare('INSERT INTO threads VALUES (?, ?)').run('saved', rollout);
  native.close();
  try {
    assert.match(run(f).stderr, /rollout history is missing/);
    assert.deepEqual(readdirSync(f.out), []);
    const external = join(f.dir, 'external.jsonl');
    writeFileSync(external, 'external content must stay outside backup');
    symlinkSync(external, rollout);
    assert.match(run(f).stderr, /not links/);
    assert.deepEqual(readdirSync(f.out), []);
  } finally { f.db.close(); }
});
