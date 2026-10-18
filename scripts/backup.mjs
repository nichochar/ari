import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod, copyFile, lstat, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

// Native history is app-owned; CODEX_HOME is deliberately never inspected or copied.
process.umask(0o077);
const source = resolve(process.env.GENIE_DB_PATH || '.local/genie.sqlite');
if (!existsSync(source)) throw new Error(`No database at ${source}; start the updated app first.`);
const runtime = `${source}.codex`;
const nativeState = join(runtime, 'state');
const directory = resolve(process.env.GENIE_BACKUP_DIR || '.local/backups');
const createdAt = new Date().toISOString();
const basename = `genie-${createdAt.replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.sqlite`;
const destination = join(directory, basename);
let stage;
let locked = false;
let publishedCompanion = false;
const guard = new DatabaseSync(source);

async function copyDatabase(from, to) {
  const reader = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(reader, to);
    await chmod(to, 0o600);
  } finally { reader.close(); }
}

function isWithin(path, directory) {
  const location = relative(directory, resolve(path));
  return location !== '' && location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
}

async function copyRollouts(from, to, files, prefix) {
  if (!(await lstat(from)).isDirectory()) throw new Error('Native Codex rollouts must be app-owned directories, not links.');
  await mkdir(to, { recursive: true, mode: 0o700 });
  for (const name of await readdir(from)) {
    const sourceFile = join(from, name);
    const destinationFile = join(to, name);
    const stat = await lstat(sourceFile);
    if (stat.isDirectory()) await copyRollouts(sourceFile, destinationFile, files, `${prefix}/${name}`);
    else if (stat.isFile()) {
      await copyFile(sourceFile, destinationFile);
      await chmod(destinationFile, 0o600);
      files.push(`${prefix}/${name}`);
    } else throw new Error('Native Codex rollouts must be app-owned regular files, not links.');
  }
}

try {
  // A separate reader is required: backing up the connection owning a write
  // transaction can stay SQLITE_BUSY. This reservation blocks new persisted runs
  // until both halves of the backup have been captured, without changing records.
  guard.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
  locked = true;
  const hasLearning = !!guard.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='learning_state'").get();
  const learning = hasLearning ? guard.prepare('SELECT payload FROM learning_state').all().map(row => JSON.parse(row.payload)) : [];
  const threadIds = new Set(learning.flatMap(data => [
    ...(data.context || []), ...(data.runs || []).flatMap(run => run.context || []),
  ]).filter(item => item?.type === 'ari_codex_context').map(item => item.threadId));
  const hasNativeContext = threadIds.size > 0;
  const hasNativeState = existsSync(nativeState);
  if (hasNativeState || hasNativeContext) {
    if (learning.some(data => (data.runs || []).some(run => run.status === 'queued' || run.status === 'running'))) {
      throw new Error('Backup deferred: a tutor response or background task is active. Retry after it finishes.');
    }
    if (!hasNativeState) throw new Error('Native Codex history is missing; refusing an incomplete backup.');
    for (const path of [runtime, nativeState]) {
      if (!(await lstat(path)).isDirectory()) throw new Error('Native Codex state must be an app-owned directory, not a link.');
    }
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  stage = join(directory, `.backup-${randomUUID()}.partial`);
  await mkdir(stage, { mode: 0o700 });
  await copyDatabase(source, join(stage, 'app.sqlite'));
  if (hasNativeState) {
    // Paginated app-server history lives in thread_history_N.sqlite, with
    // thread metadata in state_N.sqlite. Remaining databases preserve queues,
    // memory and goals. Diagnostics, config, authentication, WAL/SHM files and
    // unknown files are excluded.
    const entries = await readdir(nativeState, { withFileTypes: true });
    const names = entries.filter(entry => /^(?:state|thread_history|queue|memories(?:_v2)?|goals)_\d+\.sqlite$/.test(entry.name)).map(entry => entry.name).sort();
    if (hasNativeContext && !names.some(name => name.startsWith('state_'))) {
      throw new Error('Native Codex history is missing; refusing an incomplete backup.');
    }
    const companion = join(stage, 'codex');
    await mkdir(join(companion, 'state'), { recursive: true, mode: 0o700 });
    await mkdir(join(companion, 'workspace'), { mode: 0o700 });
    for (const name of names) {
      const path = join(nativeState, name);
      if (!(await lstat(path)).isFile()) throw new Error('Native Codex database must be an app-owned regular file, not a link.');
      await copyDatabase(path, join(companion, 'state', name));
    }
    const home = join(nativeState, 'home');
    const files = names.map(name => `state/${name}`);
    for (const folder of ['sessions', 'archived_sessions']) {
      const rollouts = join(home, folder);
      if (existsSync(rollouts)) {
        if (!(await lstat(home)).isDirectory()) throw new Error('Native Codex home must be an app-owned directory, not a link.');
        await copyRollouts(rollouts, join(companion, 'state', 'home', folder), files, `state/home/${folder}`);
      }
    }
    // The CLI also writes canonical model context to private rollout files.
    // Refuse older runtimes that backfilled global desktop metadata, rather than
    // copying unrelated threads or producing a backup that cannot resume.
    const savedIds = new Set();
    for (const name of names.filter(name => name.startsWith('state_'))) {
      const metadata = new DatabaseSync(join(companion, 'state', name), { readOnly: true });
      try {
        if (!metadata.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='threads'").get()) continue;
        for (const thread of metadata.prepare('SELECT id, rollout_path FROM threads').all()) {
          if (!['sessions', 'archived_sessions'].some(folder => isWithin(thread.rollout_path, join(home, folder)))) {
            throw new Error('Native Codex history refers outside its private runtime; refusing to copy unrelated desktop history.');
          }
          const savedRollout = join(companion, 'state', relative(nativeState, thread.rollout_path));
          if (!existsSync(savedRollout)) throw new Error('Native Codex rollout history is missing; refusing an incomplete backup.');
          savedIds.add(thread.id);
        }
      } finally { metadata.close(); }
    }
    if ([...threadIds].some(id => !savedIds.has(id))) throw new Error('Saved native Codex thread is missing; refusing an incomplete backup.');
    await writeFile(join(companion, 'backup.json'), JSON.stringify({
      version: 1, createdAt, sourceDatabase: source, sourceRuntime: runtime,
      historyMode: 'paginated', files: files.sort(),
      restore: 'Restore the SQLite file to sourceDatabase and this companion directory to sourceRuntime while the server is stopped. Sign-in remains in the local Codex installation.',
    }, null, 2) + '\n', { mode: 0o600 });
    // Publishing the main SQLite file last marks a completed bundle.
    await rename(companion, `${destination}.codex`);
    publishedCompanion = true;
  }
  await rename(join(stage, 'app.sqlite'), destination);
  console.log(`Complete backup, including snapshots${hasNativeState ? ' and native Codex history' : ''}: ${destination}`);
} catch (error) {
  if (publishedCompanion) await rm(`${destination}.codex`, { recursive: true, force: true });
  throw error;
} finally {
  try { if (stage) await rm(stage, { recursive: true, force: true }); }
  finally {
    try { if (locked) guard.exec('ROLLBACK'); }
    finally { guard.close(); }
  }
}
