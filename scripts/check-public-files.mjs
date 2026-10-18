import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Inspect Git blobs, not working files: even `git add -f` and secrets removed in
// a later commit must be caught. Never print the matching credential itself.
function git(...args) {
  return execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function privatePath(path) {
  const parts = path.toLowerCase().split('/');
  const name = parts.at(-1);
  return parts.some(part => ['.local', '.codex', '.ari', 'memories', 'backups', 'uploads', 'screenshots', 'node_modules', 'dist'].includes(part) || part.endsWith('.codex') || part.endsWith('.workspace'))
    || (name.startsWith('.env') && name !== '.env.example')
    || ['auth.json', 'chatgpt-auth.json', '.npmrc', '.netrc', 'user.md', 'tutor.md', 'memory.md', 'plan.md', '.ari-workspace.json'].includes(name)
    || /\.(?:sqlite.*|db(?:-.*)?|jsonl|pem|key|log|bundle)$/.test(name)
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(name);
}

const credentials = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

const checkedEntries = new Set();
const checkedBlobs = new Map();
const problems = new Set();
function inspect(mode, type, oid, path) {
  const key = `${mode}:${oid}:${path}`;
  if (checkedEntries.has(key)) return;
  checkedEntries.add(key);
  if (privatePath(path)) problems.add(`${JSON.stringify(path)}: private/local file`);
  // No symlinks or submodules: their target contents cannot be checked here.
  if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
    problems.add(`${JSON.stringify(path)}: unsupported linked file`);
    return;
  }
  if (!checkedBlobs.has(oid)) {
    const content = git('cat-file', 'blob', oid);
    let issue;
    if (content.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) issue = 'SQLite database';
    else if (credentials.some(pattern => pattern.test(content.toString('utf8')))) issue = 'possible credential';
    checkedBlobs.set(oid, issue);
  }
  const issue = checkedBlobs.get(oid);
  if (issue) problems.add(`${JSON.stringify(path)}: ${issue}`);
}

function inspectIndex() {
  for (const entry of git('ls-files', '--stage', '-z').toString('utf8').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (stage !== '0') problems.add(`${JSON.stringify(path)}: unresolved merge`);
    inspect(mode, 'blob', oid, path);
  }
}

function inspectHistory(tips) {
  if (!tips.length) return;
  // Scan all ancestors, including deleted files and unrelated imported history.
  // ARI's public history is small; cache each blob across revisions.
  const commits = git('rev-list', ...tips).toString('utf8').trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    for (const entry of git('ls-tree', '-rz', '--full-tree', commit).toString('utf8').split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const [mode, type, oid] = entry.slice(0, tab).split(' ');
      inspect(mode, type, oid, entry.slice(tab + 1));
    }
  }
}

try {
  const mode = process.argv[2];
  if (mode === '--staged') inspectIndex();
  else if (mode === '--history') inspectHistory(['HEAD']);
  else if (mode === '--pre-push') {
    const tips = new Set();
    for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
      const [, oid] = line.trim().split(/\s+/);
      if (!/^[0-9a-f]{40,64}$/.test(oid || '')) throw new Error('Invalid push input.');
      if (!/^0+$/.test(oid)) tips.add(oid);
    }
    inspectHistory([...tips]);
  } else throw new Error('Use --staged, --history, or --pre-push.');

  if (problems.size) {
    console.error('ARI privacy check blocked this operation:');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('Keep personal data in ignored local storage; remove credentials from every affected commit before pushing.');
    process.exitCode = 1;
  } else console.log('ARI privacy check passed.');
} catch {
  // Git errors can contain arbitrary file contents; don't echo raw output.
  console.error('ARI privacy check could not complete. Resolve the Git/check configuration before continuing.');
  process.exitCode = 1;
}
