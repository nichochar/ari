import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
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
function run(f: ReturnType<typeof fixture>, environment: Record<string, string> = {}) {
  return spawnSync(process.execPath, [resolve('scripts/backup.mjs')], {
    encoding: 'utf8', env: { ...process.env, ARI_DB_PATH: f.path, ARI_BACKUP_DIR: f.out, ...environment }, timeout: 15_000,
  });
}
function databaseValue(path: string, query: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(query).get(); } finally { db.close(); }
}

function personalizationFixture(f: ReturnType<typeof fixture>) {
  const rootPath = join(realpathSync(f.dir), 'personalization');
  const workspaceId = 'synthetic-workspace';
  mkdirSync(join(rootPath, 'memories', 'observations'), { recursive: true });
  writeFileSync(join(rootPath, '.ari-workspace.json'), JSON.stringify({ workspaceId }) + '\n');
  f.db.exec('CREATE TABLE personalization_metadata (learner_id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE personalization_revisions (learner_id TEXT, path TEXT, revision INTEGER, payload TEXT)');
  f.db.prepare('INSERT INTO personalization_metadata VALUES (?, ?)').run('local', JSON.stringify({ rootPath, workspaceId, migrated: true, onboarding: { status: 'complete', updatedAt: '2026-10-18T12:00:00.000Z' } }));
  const contents: Record<string, string> = { 'TUTOR.md': '# Tutor\nAsk one question.\n', 'USER.md': '# Learner\nGoal: botany.\n', 'memories/observations/leaves.md': '# Observation\nEvidence: exercise-one\n' };
  for (const [path, content] of Object.entries(contents)) {
    writeFileSync(join(rootPath, path), content);
    const revision = { path, content, hash: createHash('sha256').update(content).digest('hex'), revision: 1, updatedAt: '2026-10-18T12:00:00.000Z', actor: 'user' };
    f.db.prepare('INSERT INTO personalization_revisions VALUES (?, ?, ?, ?)').run('local', path, 1, JSON.stringify(revision));
  }
  return { rootPath, workspaceId, contents };
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

test('backup includes bound Markdown and immutable revisions with private permissions, excluding unrelated files', () => {
  const f = fixture();
  const personal = personalizationFixture(f);
  writeFileSync(join(personal.rootPath, 'auth.json'), 'credentials must stay outside the backup');
  writeFileSync(join(personal.rootPath, 'memories', 'diagnostics.log'), 'diagnostics must stay outside the backup');
  try {
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    const main = readdirSync(f.out).find(name => name.endsWith('.sqlite'))!;
    assert.deepEqual(readdirSync(f.out).sort(), [main, `${main}.workspace`]);
    const saved = join(f.out, `${main}.workspace`);
    assert.deepEqual(readdirSync(saved).sort(), ['.ari-workspace.json', 'TUTOR.md', 'USER.md', 'memories']);
    assert.deepEqual(readdirSync(join(saved, 'memories')), ['observations']);
    for (const [path, content] of Object.entries(personal.contents)) {
      assert.equal(readFileSync(join(saved, path), 'utf8'), content);
      assert.equal(statSync(join(saved, path)).mode & 0o777, 0o600);
    }
    assert.equal(statSync(saved).mode & 0o777, 0o700);
    assert.equal(JSON.parse(readFileSync(join(saved, '.ari-workspace.json'), 'utf8')).workspaceId, personal.workspaceId);
    assert.equal(databaseValue(join(f.out, main), 'SELECT COUNT(*) AS count FROM personalization_revisions')!.count, 3);
    assert.equal(JSON.parse(databaseValue(join(f.out, main), 'SELECT payload FROM personalization_metadata')!.payload as string).rootPath, personal.rootPath);
  } finally { f.db.close(); }
});

test('unobserved external edits refuse inconsistent personalization backup without publishing artifacts', () => {
  const f = fixture();
  const personal = personalizationFixture(f);
  writeFileSync(join(personal.rootPath, 'USER.md'), '# Changed outside ARI\n');
  try {
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /files differ from recorded revisions/);
    assert.equal(readdirSync(f.dir).includes('backups'), false);
    assert.equal(readFileSync(join(personal.rootPath, 'USER.md'), 'utf8'), '# Changed outside ARI\n');
  } finally { f.db.close(); }
});

test('workspace marker mismatch, escaping bindings and linked notes all refuse backups', () => {
  for (const scenario of ['marker', 'relative', 'file-link', 'directory-link', 'root-link']) {
    const f = fixture();
    const personal = personalizationFixture(f);
    try {
      if (scenario === 'marker') writeFileSync(join(personal.rootPath, '.ari-workspace.json'), JSON.stringify({ workspaceId: 'different-owner' }));
      if (scenario === 'relative') f.db.prepare('UPDATE personalization_metadata SET payload = ?').run(JSON.stringify({ ...personal, rootPath: '../outside', migrated: true }));
      if (scenario === 'file-link') symlinkSync(f.path, join(personal.rootPath, 'memories', 'linked.md'));
      if (scenario === 'directory-link') symlinkSync(f.dir, join(personal.rootPath, 'memories', 'linked-directory'));
      if (scenario === 'root-link') {
        symlinkSync(personal.rootPath, join(f.dir, 'linked-root'));
        f.db.prepare('UPDATE personalization_metadata SET payload = ?').run(JSON.stringify({ ...personal, rootPath: join(realpathSync(f.dir), 'linked-root'), migrated: true }));
      }
      const result = run(f);
      assert.notEqual(result.status, 0, scenario);
      assert.match(result.stderr, /Personalization workspace (?:identity|binding|must contain no symbolic links)/, scenario);
      assert.equal(readdirSync(f.dir).includes('backups'), false, scenario);
    } finally { f.db.close(); }
  }
});

test('notes changed during copying reject the bundle and remove already-published companions', () => {
  const f = fixture();
  const personal = personalizationFixture(f);
  mkdirSync(`${f.path}.codex/state`, { recursive: true });
  const native = new DatabaseSync(`${f.path}.codex/state/state_5.sqlite`);
  native.exec('CREATE TABLE metadata (value TEXT)');
  native.close();
  // Simulate an external editor immediately after the initial USER.md read.
  // This controls the race deterministically without adding hooks to the backup script.
  const hook = join(f.dir, 'external-editor.mjs');
  const userPath = join(personal.rootPath, 'USER.md');
  writeFileSync(hook, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const originalOpen = fs.open;
let changed = false;
fs.open = async function(path, ...args) {
  const handle = await originalOpen(path, ...args);
  const originalRead = handle.readFile.bind(handle);
  handle.readFile = async function(...readArgs) {
    const result = await originalRead(...readArgs);
    if (!changed && String(path) === ${JSON.stringify(userPath)}) {
      changed = true;
      await fs.writeFile(path, '# Concurrent edit\\n');
    }
    return result;
  };
  return handle;
};
syncBuiltinESMExports();
`);
  try {
    const result = run(f, { NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workspace changed during backup/);
    assert.deepEqual(readdirSync(f.out), []);
    assert.equal(readFileSync(userPath, 'utf8'), '# Concurrent edit\n');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM personalization_revisions').get()!.count, 3);
  } finally { f.db.close(); }
});
