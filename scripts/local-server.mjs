import { spawn, execFileSync } from 'node:child_process';
import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const command = process.argv[2] || 'start';
if (!['start', 'stop', 'status'].includes(command)) throw new Error('Use start, stop, or status.');
const url = `http://127.0.0.1:${port}`;
const directory = join(root, '.local');
const recordPath = join(directory, `server-${port}.json`);
const script = join(root, 'server', 'index.ts');
const logPath = join(directory, `server-${port}.log`);

async function health() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

if (command === 'status') {
  const result = await health();
  console.log(result ? `Running at ${url} — tutor ${result.aiConfigured ? 'configured' : 'unavailable'}.` : `No ARI server at ${url}.`);
  process.exitCode = result ? 0 : 1;
} else if (command === 'stop') {
  let record;
  try { record = JSON.parse(await readFile(recordPath, 'utf8')); }
  catch { throw new Error(`No managed server record for port ${port}. Stop its original process instead.`); }
  let invocation = '';
  try { invocation = execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' }).trim(); }
  catch { /* Already stopped. */ }
  if (invocation) {
    if (record.script !== script || !invocation.includes(script)) throw new Error('PID no longer belongs to this server. Refusing to stop it.');
    process.kill(record.pid, 'SIGTERM');
    let stopped = false;
    for (let attempt = 0; attempt < 65; attempt++) {
      try { process.kill(record.pid, 0); }
      catch { stopped = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!stopped) throw new Error('Server has not stopped yet. Its managed record was preserved.');
  }
  await unlink(recordPath);
  console.log(`Stopped managed server on port ${port}.`);
} else {
  if (await health()) {
    console.log(`Already running at ${url}.`);
  } else {
    await mkdir(directory, { recursive: true });
    const log = await open(logPath, 'a', 0o600);
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: root, detached: true, env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    await log.close();
    await writeFile(recordPath, JSON.stringify({ pid: child.pid, script, port, startedAt: new Date().toISOString() }), { mode: 0o600 });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await health()) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Server did not become ready. Read ${logPath}.`);
    console.log(`ARI is running in the background at ${url}. Logs: ${logPath}`);
  }
}
