import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 3002;
try {
  await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
  throw new Error('Port 3002 is already in use. Stop that preview first (PORT=3002 npm run stop). Your main app stays running.');
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Port 3002')) throw error;
}
const dist = resolve(root, process.env.ARI_DEMO_DIST_PATH || 'dist');
await access(join(dist, 'index.html')).catch(() => { throw new Error('Build ARI first with npm run build.'); });
const id = randomUUID();
const directory = join(root, '.local', 'onboarding', id);
await mkdir(directory, { recursive: true, mode: 0o700 });
const result = spawnSync(process.execPath, [join(root, 'scripts', 'local-server.mjs'), 'start'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(port),
    ARI_DB_PATH: join(directory, 'state.sqlite'), ARI_WORKSPACE_PATH: join(directory, 'workspace'),
    ARI_LEGACY_PATH: join(directory, 'no-legacy.json'), ARI_DIST_PATH: dist },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const url = `http://localhost:${port}/?onboardingPreview=${id}`;
await writeFile(join(root, '.local', 'onboarding', 'latest.json'), JSON.stringify({ url, directory }), { mode: 0o600 });
console.log(`\nFresh learner preview: ${url}\nYour usual profile is unchanged. Stop this preview with PORT=3002 npm run stop.`);
