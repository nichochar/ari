import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexArguments, codexIsAvailable, codexSettings, createCodexAsk } from '../server/codex-provider.js';

test('conversation uses Astra high while other tasks retain their configured model', () => {
  const env = {
    CODEX_MODEL: 'gpt-5.6-sol', CODEX_REASONING_EFFORT: 'low',
    CODEX_TUTOR_MODEL: 'gpt-6-astra', CODEX_TUTOR_REASONING_EFFORT: 'high',
  };
  const tutor = codexSettings('tutor', env);
  assert.deepEqual(tutor, { model: 'gpt-6-astra', reasoningEffort: 'high' });
  const args = codexArguments('tutor', '/tmp/ari-test', tutor.model, '/tmp/ari-test/paper.jpg', tutor.reasoningEffort);
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra');
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(!args.includes('model_reasoning_effort="low"'));
  assert.equal(args[args.indexOf('--image') + 1], '/tmp/ari-test/paper.jpg');
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('cli_auth_credentials_store="file"'));
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  for (const task of ['generate', 'verify', 'plan', 'review'] as const) {
    assert.deepEqual(codexSettings(task, env), { model: 'gpt-5.6-sol', reasoningEffort: 'low' });
  }
});

test('tutor inherits base settings unless overridden, and invalid effort fails explicitly', () => {
  assert.deepEqual(codexSettings('tutor', {}), { model: 'gpt-5.6-sol', reasoningEffort: 'low' });
  assert.deepEqual(codexSettings('tutor', { CODEX_MODEL: 'gpt-6-astra', CODEX_REASONING_EFFORT: 'high' }),
    { model: 'gpt-6-astra', reasoningEffort: 'high' });
  assert.throws(() => codexSettings('tutor', { CODEX_TUTOR_REASONING_EFFORT: 'hihg' }), /Invalid Codex reasoning/);
});

test('Codex arguments preserve the order of multiple images and legacy single images', () => {
  const directory = '/tmp/ari-test';
  const first = `${directory}/work-01.jpg`;
  const second = `${directory}/work-02.png`;
  const args = codexArguments('tutor', directory, 'gpt-6-astra', [first, second], 'high');
  assert.deepEqual(args.slice(args.indexOf('--image')), ['--image', first, second, '-']);
  assert.deepEqual(codexArguments('tutor', directory, 'gpt-6-astra', first, 'high').slice(-3),
    ['--image', first, '-']);
  assert.equal(codexArguments('tutor', directory, 'gpt-6-astra', []).includes('--image'), false);
});

test('Codex adapter attaches all images in order with private files and removes them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-codex-test-'));
  const binary = join(directory, 'codex-stub.cjs');
  const reportPath = join(directory, 'report.json');
  const originalBin = process.env.CODEX_BIN;
  try {
    const source = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const imageIndex = args.indexOf('--image');
const paths = imageIndex < 0 ? [] : args.slice(imageIndex + 1, -1);
const report = { args, paths, files: paths.map(path => ({ name: require('node:path').basename(path),
  bytes: fs.readFileSync(path).toString(), mode: fs.statSync(path).mode & 0o777 })) };
fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(report));
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], '{"ok":true}');
`;
    await writeFile(binary, source, { mode: 0o700 });
    await chmod(binary, 0o700);
    process.env.CODEX_BIN = binary;
    const ask = createCodexAsk();
    const result = await ask('tutor', 'Tutor instructions', { imageOrder: [{ position: 1 }, { position: 2 }] }, [
      `data:image/jpeg;base64,${Buffer.from('first page').toString('base64')}`,
      `data:image/png;base64,${Buffer.from('second page').toString('base64')}`,
    ]);
    assert.deepEqual(result, { ok: true });
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      args: string[]; paths: string[]; files: { name: string; bytes: string; mode: number }[];
    };
    assert.deepEqual(report.files, [
      { name: 'work-01.jpg', bytes: 'first page', mode: 0o600 },
      { name: 'work-02.png', bytes: 'second page', mode: 0o600 },
    ]);
    assert.deepEqual(report.args.slice(report.args.indexOf('--image')),
      ['--image', ...report.paths, '-']);
    assert.ok(report.paths.every(path => !existsSync(path)));
    assert.ok(!existsSync(report.args[report.args.indexOf('--cd') + 1]));
  } finally {
    if (originalBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = originalBin;
    await rm(directory, { recursive: true, force: true });
  }
});


test('availability checks the same file-based ChatGPT login as the tutor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-login-test-'));
  const binary = join(directory, 'codex.cjs');
  const reportPath = join(directory, 'arguments.json');
  const originalBin = process.env.CODEX_BIN;
  try {
    await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(process.argv.slice(2)));
console.log('Logged in using ChatGPT');
`, { mode: 0o700 });
    process.env.CODEX_BIN = binary;
    assert.equal(codexIsAvailable(), true);
    const args = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual(args, ['-c', 'cli_auth_credentials_store="file"', 'login', 'status']);
    await writeFile(binary, `#!${process.execPath}
console.log('Logged in using an API key');
`, { mode: 0o700 });
    assert.equal(codexIsAvailable(), false);
  } finally {
    if (originalBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = originalBin;
    await rm(directory, { recursive: true, force: true });
  }
});
