import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod, copyFile, lstat, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Native history is app-owned; CODEX_HOME is deliberately never inspected or copied.
process.umask(0o077);
const source = resolve(process.env.ARI_DB_PATH || '.local/ari.sqlite');
if (!existsSync(source)) throw new Error(`No database at ${source}; start the updated app first.`);
const runtime = `${source}.codex`;
const nativeState = join(runtime, 'state');
const directory = resolve(process.env.ARI_BACKUP_DIR || '.local/backups');
const createdAt = new Date().toISOString();
const basename = `ari-${createdAt.replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.sqlite`;
const destination = join(directory, basename);
let stage;
let locked = false;
let publishedCompanion = false;
let publishedWorkspace = false;
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

async function assertWorkspacePath(path) {
  // Permit only macOS's standard system aliases, never user-created links.
  let canonical = resolve(path);
  if (process.platform === 'darwin') {
    const alias = ['/var', '/tmp', '/etc'].find(prefix => canonical === prefix || canonical.startsWith(`${prefix}/`));
    if (alias) canonical = join(await realpath(alias), canonical.slice(alias.length));
  }
  const parts = canonical.split(sep).filter(Boolean);
  let current = sep;
  for (const part of parts) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Personalization workspace must contain no symbolic links or escaping paths.');
  }
  return canonical;
}

function validMemoryPath(path) {
  const parts = path.split('/');
  return parts[0] === 'memories' && parts.length > 1 && parts.at(-1).endsWith('.md') && parts.every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.'));
}

async function workspaceSnapshot(rootPath, workspaceId) {
  const root = await assertWorkspacePath(rootPath);
  if (!(await lstat(root)).isDirectory()) throw new Error('Personalization workspace must be a regular directory.');
  const files = new Map();
  const scan = async (relativePath = '') => {
    const from = join(root, relativePath);
    if (!(await lstat(from)).isDirectory()) throw new Error('Personalization workspace directories must not be links.');
    for (const name of (await readdir(from)).sort()) {
      const path = relativePath ? `${relativePath}/${name}` : name;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) throw new Error('Personalization workspace must contain no symbolic links or escaping paths.');
      const included = path === '.ari-workspace.json' || path === 'TUTOR.md' || path === 'USER.md' || validMemoryPath(path);
      if (stat.isDirectory()) {
        if (path === 'memories' || (path.startsWith('memories/') && path.split('/').every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.')))) await scan(path);
      } else if (included) {
        if (!stat.isFile()) throw new Error('Personalization workspace files must be regular files.');
        const maximum = path === '.ari-workspace.json' ? 4096 : (path === 'TUTOR.md' || path === 'USER.md' ? 12000 : 64000) * 4;
        if (stat.size > maximum) throw new Error('Personalization workspace document exceeds its size limit.');
        await assertWorkspacePath(join(root, path));
        const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let content;
        try {
          if (!(await handle.stat()).isFile()) throw new Error('Personalization workspace files must be regular files.');
          content = await handle.readFile();
        } finally { await handle.close(); }
        if (content.length > maximum) throw new Error('Personalization workspace changed during backup; retry when notes are idle.');
        files.set(path, { content, hash: createHash('sha256').update(content).digest('hex') });
        if (files.size > 5001) throw new Error('Personalization workspace has too many files.');
      }
    }
  };
  await scan();
  for (const name of ['TUTOR.md', 'USER.md', '.ari-workspace.json']) if (!files.has(name)) throw new Error('Personalization workspace is incomplete; refusing an incomplete backup.');
  const marker = JSON.parse(files.get('.ari-workspace.json').content.toString('utf8'));
  if (marker.workspaceId !== workspaceId) throw new Error('Personalization workspace identity does not match its database binding.');
  return files;
}

function sameWorkspace(first, second) {
  return first.size === second.size && [...first].every(([path, file]) => second.get(path)?.hash === file.hash);
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
  const hasPersonalization = !!guard.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='personalization_metadata'").get();
  const bindings = hasPersonalization ? guard.prepare('SELECT learner_id, payload FROM personalization_metadata').all().map(row => ({ learnerId: row.learner_id, ...JSON.parse(row.payload) })) : [];
  if (bindings.length > 1) throw new Error('Backup requires one personalization workspace binding; multiple learner workspaces must be backed up separately.');
  const binding = bindings[0];
  let workspaceFiles;
  if (binding) {
    if (typeof binding.rootPath !== 'string' || !isAbsolute(binding.rootPath) || resolve(binding.rootPath) !== binding.rootPath || typeof binding.workspaceId !== 'string' || !binding.migrated) throw new Error('Personalization workspace binding is invalid or migration is incomplete.');
    workspaceFiles = await workspaceSnapshot(binding.rootPath, binding.workspaceId);
    const hasRevisions = !!guard.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='personalization_revisions'").get();
    if (!hasRevisions) throw new Error('Personalization revision history is missing; refusing an incomplete backup.');
    const revisions = guard.prepare(`SELECT r.path, r.payload FROM personalization_revisions r JOIN (
      SELECT path, MAX(revision) AS revision FROM personalization_revisions WHERE learner_id = ? GROUP BY path
    ) latest ON r.path = latest.path AND r.revision = latest.revision WHERE r.learner_id = ?`).all(binding.learnerId, binding.learnerId);
    const expected = new Map(revisions.map(row => [row.path, JSON.parse(row.payload)]));
    const currentFiles = [...workspaceFiles].filter(([path]) => path !== '.ari-workspace.json');
    if (currentFiles.some(([path, file]) => expected.get(path)?.deleted || expected.get(path)?.hash !== file.hash) || [...expected].some(([path, revision]) => !revision.deleted && !workspaceFiles.has(path))) {
      throw new Error('Personalization files differ from recorded revisions. Open Settings to refresh edited notes, then retry backup.');
    }
  }
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
  if (workspaceFiles) {
    const companion = join(stage, 'workspace');
    await mkdir(companion, { mode: 0o700 });
    for (const [path, file] of workspaceFiles) {
      const target = join(companion, path);
      if (!isWithin(target, companion)) throw new Error('Personalization file escapes its workspace.');
      const parent = resolve(target, '..');
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await writeFile(target, file.content, { flag: 'wx', mode: 0o600 });
    }
  }
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
  if (workspaceFiles) {
    const current = await workspaceSnapshot(binding.rootPath, binding.workspaceId);
    const staged = await workspaceSnapshot(join(stage, 'workspace'), binding.workspaceId);
    if (!sameWorkspace(workspaceFiles, current) || !sameWorkspace(workspaceFiles, staged)) throw new Error('Personalization workspace changed during backup; retry when notes are idle.');
    await rename(join(stage, 'workspace'), `${destination}.workspace`);
    publishedWorkspace = true;
  }
  await rename(join(stage, 'app.sqlite'), destination);
  console.log(`Complete backup, including snapshots${hasNativeState ? ', native Codex history' : ''}${workspaceFiles ? ', and personalization files' : ''}: ${destination}`);
} catch (error) {
  if (publishedCompanion) await rm(`${destination}.codex`, { recursive: true, force: true });
  if (publishedWorkspace) await rm(`${destination}.workspace`, { recursive: true, force: true });
  throw error;
} finally {
  try { if (stage) await rm(stage, { recursive: true, force: true }); }
  finally {
    try { if (locked) guard.exec('ROLLBACK'); }
    finally { guard.close(); }
  }
}
