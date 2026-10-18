import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

const project = fileURLToPath(new URL('..', import.meta.url));
const checker = join(project, 'scripts/check-public-files.mjs');

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ari-privacy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git('init', '-q');
  git('config', 'user.name', 'ARI tests');
  git('config', 'user.email', 'tests@example.invalid');
  write('.gitignore', '.local/\n.env\n');
  git('add', '.gitignore');
  git('commit', '-qm', 'Safe initial commit');
  const check = (mode: string, input?: string) => spawnSync(process.execPath, [checker, mode], { cwd: root, encoding: 'utf8', input });
  return { root, git, write, check };
}

test('privacy guard permits generic source and example configuration', t => {
  const f = fixture(t);
  f.write('.env.example', 'OPENAI_API_KEY=your-api-key\n');
  f.write('src/app.ts', 'export const title = "ARI";\n');
  f.git('add', '.');
  assert.equal(f.check('--staged').status, 0);
});

test('privacy guard blocks forced private files and renamed SQLite data', t => {
  const f = fixture(t);
  f.write('.local/progress.txt', 'Synthetic learner notes');
  f.write('.env', 'SYNTHETIC_SETTING=example');
  f.write('innocent.bin', 'SQLite format 3\0synthetic database');
  f.git('add', '-f', '.local/progress.txt', '.env', 'innocent.bin');
  const result = f.check('--staged');
  assert.equal(result.status, 1);
  for (const path of ['.local/progress.txt', '.env', 'innocent.bin']) assert.ok(result.stderr.includes(path));
});

test('privacy guard reads staged credentials even after the working file is fixed', t => {
  const f = fixture(t);
  const fake = 'sk-proj-' + 'x'.repeat(40);
  f.write('config.ts', `const key = '${fake}';`);
  f.git('add', 'config.ts');
  f.write('config.ts', 'const key = process.env.OPENAI_API_KEY;');
  const result = f.check('--staged');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /possible credential/);
  assert.ok(!result.stderr.includes(fake), 'must not print credentials');
});

test('privacy guard rejects personalization documents and workspace exports', t => {
  const f = fixture(t);
  const paths = ['TUTOR.md', 'memories/learning.md', 'export.workspace/notes.md', '.ari-workspace.json'];
  for (const path of paths) f.write(path, 'Synthetic private personalization');
  f.git('add', '-f', ...paths);
  const result = f.check('--staged');
  assert.equal(result.status, 1);
  for (const path of paths) assert.ok(result.stderr.includes(path));
});

test('history and push checks catch a credential deleted by a later commit', t => {
  const f = fixture(t);
  f.write('config.ts', 'const key = "' + 'ghp_' + 'x'.repeat(36) + '";');
  f.git('add', '.');
  f.git('commit', '-qm', 'Synthetic accidental credential');
  f.git('rm', 'config.ts');
  f.git('commit', '-qm', 'Remove credential');
  assert.equal(f.check('--staged').status, 0);
  assert.equal(f.check('--history').status, 1);
  const tip = f.git('rev-parse', 'HEAD');
  assert.equal(f.check('--pre-push', `refs/heads/test ${tip} refs/heads/test ${'0'.repeat(40)}\n`).status, 1);
});

test('push check includes every pushed ref and permits deleting refs', t => {
  const f = fixture(t);
  const safe = f.git('rev-parse', 'HEAD');
  f.write('USER.md', 'Synthetic private memory');
  f.git('add', '.');
  f.git('commit', '-qm', 'Private notes in separate ref');
  const privateTip = f.git('rev-parse', 'HEAD');
  const zero = '0'.repeat(40);
  assert.equal(f.check('--pre-push', `refs/heads/main ${safe} refs/heads/main ${zero}\nrefs/heads/notes ${privateTip} refs/heads/notes ${zero}\n`).status, 1);
  assert.equal(f.check('--pre-push', `(delete) ${zero} refs/heads/notes ${privateTip}\n`).status, 0);
});

test('installed hooks reject a real commit of forced local data', t => {
  const f = fixture(t);
  for (const file of ['scripts/check-public-files.mjs', 'scripts/setup-hooks.mjs', '.githooks/pre-commit', '.githooks/pre-push']) {
    mkdirSync(dirname(join(f.root, file)), { recursive: true });
    copyFileSync(join(project, file), join(f.root, file));
    if (file.startsWith('.githooks/')) chmodSync(join(f.root, file), 0o755);
  }
  const setup = () => spawnSync(process.execPath, ['scripts/setup-hooks.mjs'], { cwd: f.root, encoding: 'utf8' });
  assert.equal(setup().status, 0);
  assert.equal(setup().status, 0, 'installation is idempotent');
  f.write('.local/work.txt', 'Synthetic learner work');
  f.git('add', '-f', '.local/work.txt');
  const commit = spawnSync('git', ['commit', '-qm', 'Should be blocked'], { cwd: f.root, encoding: 'utf8' });
  assert.equal(commit.status, 1);
  assert.match(commit.stderr, /private\/local file/);
  assert.equal(f.git('rev-list', '--count', 'HEAD'), '1');
});

test('hook installer preserves an existing custom hooks configuration', t => {
  const f = fixture(t);
  f.git('config', '--local', 'core.hooksPath', 'existing-hooks');
  const install = spawnSync(process.execPath, [join(project, 'scripts/setup-hooks.mjs')], { cwd: f.root, encoding: 'utf8' });
  assert.notEqual(install.status, 0);
  assert.equal(f.git('config', '--get', 'core.hooksPath'), 'existing-hooks');
});

test('installed pre-push hook prevents private history reaching a remote', t => {
  const f = fixture(t);
  f.write('PLAN.md', 'Synthetic personal project context');
  f.git('add', 'PLAN.md');
  f.git('commit', '-qm', 'Synthetic private history');
  f.git('rm', 'PLAN.md');
  f.git('commit', '-qm', 'Remove private file');
  for (const file of ['scripts/check-public-files.mjs', 'scripts/setup-hooks.mjs', '.githooks/pre-push']) {
    mkdirSync(dirname(join(f.root, file)), { recursive: true });
    copyFileSync(join(project, file), join(f.root, file));
    if (file.startsWith('.githooks/')) chmodSync(join(f.root, file), 0o755);
  }
  execFileSync(process.execPath, ['scripts/setup-hooks.mjs'], { cwd: f.root });
  const remote = join(f.root, 'remote.git');
  f.git('init', '--bare', '-q', remote);
  const push = spawnSync('git', ['push', remote, 'HEAD:refs/heads/main'], { cwd: f.root, encoding: 'utf8' });
  assert.notEqual(push.status, 0);
  assert.match(push.stderr, /private\/local file/);
  assert.equal(f.git('--git-dir=' + remote, 'rev-list', '--all', '--count'), '0');
});
