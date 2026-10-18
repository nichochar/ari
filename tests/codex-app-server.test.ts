import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  codexAppServerEnvironment, createCodexAppServer, CodexTransportError,
  type CodexAppServerOptions,
} from '../server/codex-app-server.js';

async function fakeServer(t: TestContext, body = '', options: Partial<CodexAppServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ari-app-server-test-'));
  const binary = join(directory, 'codex.cjs');
  const authHome = join(directory, 'managed-auth');
  await mkdir(authHome, { mode: 0o700 });
  await writeFile(join(authHome, 'auth.json'), 'synthetic managed auth fixture', { mode: 0o600 });
  await writeFile(join(authHome, 'config.toml'), 'model="unrelated-user-model"', { mode: 0o600 });
  await mkdir(join(authHome, 'sessions'), { mode: 0o700 });
  await writeFile(join(authHome, 'sessions', 'unrelated.jsonl'), 'synthetic unrelated history');
  await writeFile(binary, `#!${process.execPath}
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const reply = (message, result) => send({ id: message.id, result });
const input = readline.createInterface({input:process.stdin});
let initialization;
let initialized = false;
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') { initialization = message.params; return reply(message, {}); }
  if (message.method === 'config/read') return reply(message, {config: {mcp_servers: {
    'a.server': {env: {TOKEN: 'do-not-expose'}}, ordinary: {url: 'private-url'}
  }}});
  if (message.method === 'initialized') { initialized = true; return; }
  ${body}
  if (message.method === 'metadata') return reply(message, {args:process.argv.slice(2),cwd:process.cwd(),codexHome:process.env.CODEX_HOME, envKeys:Object.keys(process.env),pid:process.pid,initialization,initialized});
  if (message.method === 'echo') return reply(message, message.params);
});
`, { mode: 0o700 });
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const client = await createCodexAppServer({ binary, cwd: join(directory, 'runtime'), stateDir: join(directory, 'state'), authHome, requestTimeoutMs: 2000, ...options });
  t.after(() => client.close());
  return { client, directory };
}

function transportCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof CodexTransportError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  };
}

test('app-server isolates state and environment while retaining ChatGPT auth and research', async t => {
  assert.deepEqual(codexAppServerEnvironment({ PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/codex', OPENAI_API_KEY: 'secret', DATABASE_PASSWORD: 'secret', NODE_OPTIONS: '--require bad', HTTPS_PROXY: 'secret' }),
    { PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/codex' });
  const { client, directory } = await fakeServer(t);
  const metadata = await client.request<{ args: string[]; cwd: string; codexHome: string; envKeys: string[]; initialization: unknown; initialized: boolean }>('metadata', {});
  assert.deepEqual(metadata.initialization, { clientInfo: { name: 'ari_tutor', title: 'ARI tutor', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  assert.equal(metadata.initialized, true);
  assert.equal(metadata.cwd, await realpath(join(directory, 'runtime')));
  assert.equal(metadata.codexHome, join(directory, 'state', 'home'));
  const authReference = join(directory, 'state', 'home', 'auth.json');
  assert.equal((await lstat(authReference)).isSymbolicLink(), true);
  assert.equal(await readlink(authReference), join(directory, 'managed-auth', 'auth.json'));
  assert.deepEqual(await readdir(join(directory, 'state', 'home')), ['auth.json']);
  assert.ok(metadata.args.includes(`sqlite_home=${JSON.stringify(join(directory, 'state'))}`));
  assert.ok(metadata.args.includes(`log_dir=${JSON.stringify(join(directory, 'state', 'logs'))}`));
  assert.ok(metadata.args.includes('web_search="live"'));
  assert.ok(metadata.args.includes('project_doc_max_bytes=0'));
  assert.ok(metadata.args.includes('forced_login_method="chatgpt"'));
  assert.ok(metadata.args.includes('cli_auth_credentials_store="file"'));
  assert.ok(metadata.args.includes('approval_policy="never"'));
  assert.equal(metadata.args[metadata.args.indexOf('code_mode_host') - 1], '--enable');
  for (const feature of ['code_mode', 'code_mode_only', 'code_mode_tool_search']) {
    assert.equal(metadata.args[metadata.args.indexOf(feature) - 1], '--disable');
  }
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'computer_use', 'view_image', 'memories']) {
    assert.equal(metadata.args[metadata.args.indexOf(feature) - 1], '--disable');
  }
  assert.equal(metadata.envKeys.includes('OPENAI_API_KEY'), false);
  assert.equal(metadata.envKeys.includes('NODE_OPTIONS'), false);
  assert.deepEqual(client.threadConfig, { mcp_servers: { 'a.server': { enabled: false }, ordinary: { enabled: false } } });
  assert.equal(JSON.stringify(client.threadConfig).includes('do-not-expose'), false);
});

test('notifications and tool requests preserve order while nested RPC responses bypass dispatch', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'begin') {
    send({method:'first',params:{}});
    send({method:'second',params:{}});
    send({id:'tool-1',method:'item/tool/call',params:{name:'lookup'}});
    return reply(message, {});
  }
  if (message.id === 'tool-1' && !message.method) return send({method:'tool-result',params:message.result});
  `);
  const order: string[] = [];
  let finish!: (value: unknown) => void;
  const complete = new Promise(resolve => { finish = resolve; });
  client.subscribe(async event => {
    if (event.method === 'first') {
      order.push('first-start');
      assert.equal(await client.request('echo', 'nested'), 'nested');
      order.push('first-end');
    } else if (event.method === 'tool-result') finish(event.params);
    else order.push(event.method);
  });
  client.onRequest(async request => {
    assert.equal(request.id, 'tool-1');
    order.push('tool');
    return { contentItems: [{ type: 'inputText', text: await client.request('echo', 'learner history') }], success: true };
  });
  await client.request('begin', {});
  assert.deepEqual(await complete, { contentItems: [{ type: 'inputText', text: 'learner history' }], success: true });
  assert.deepEqual(order, ['first-start', 'first-end', 'second', 'tool']);
});

test('unexpected approval requests are denied without invoking dynamic tools', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'approval') {
    send({id:12,method:'item/commandExecution/requestApproval',params:{command:'do not execute'}});
    return reply(message, {});
  }
  if (message.id === 12 && !message.method) return send({method:'denied',params:message});
  `);
  let handled = false;
  client.onRequest(() => { handled = true; });
  const denied = new Promise<unknown>(resolve => client.subscribe(event => { if (event.method === 'denied') resolve(event.params); }));
  await client.request('approval', {});
  assert.deepEqual(await denied, { id: 12, error: { code: -32601, message: 'This client does not permit this request.' } });
  assert.equal(handled, false);
});

test('remote errors are classified without disclosing diagnostics or parameters', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'fail') return send({id:message.id,error:{code:-1,message:'authentication failed secret-value private-path',data:{key:'secret'}}});
  `);
  await assert.rejects(client.request('fail', { learner: 'private' }), transportCode('CODEX_AUTH'));
  assert.equal(await client.request('echo', 'still open'), 'still open');
});

test('tool handler errors return sanitized protocol errors', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'tool') {
    send({id:'tool-error',method:'item/tool/call',params:{name:'lookup'}});
    return reply(message, {});
  }
  if (message.id === 'tool-error' && !message.method) return send({method:'tool-error-result',params:message});
  `);
  client.onRequest(() => { throw new Error('private learner data secret-value'); });
  const result = new Promise<unknown>(resolve => client.subscribe(event => { if (event.method === 'tool-error-result') resolve(event.params); }));
  await client.request('tool', {});
  assert.deepEqual(await result, { id: 'tool-error', error: { code: -32603, message: 'Tool execution failed.' } });
});

test('malformed protocol rejects every pending request and closes the child', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'malformed') { process.stdout.write('not-json secret-value\\n'); return; }
  `);
  let closeCode: string | undefined;
  client.onClose(error => { closeCode = error.code; });
  const first = client.request('hang', {});
  const second = client.request('malformed', {});
  await Promise.all([
    assert.rejects(first, transportCode('CODEX_PROTOCOL')),
    assert.rejects(second, transportCode('CODEX_PROTOCOL')),
  ]);
  assert.equal(closeCode, 'CODEX_PROTOCOL');
  await assert.rejects(client.request('echo', {}), transportCode('CODEX_PROTOCOL'));
});

test('oversized and unterminated protocol lines are bounded', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'oversized') { process.stdout.write('x'.repeat(4097)); return; }
  `, { maxLineBytes: 4096 });
  await assert.rejects(client.request('oversized', {}), transportCode('CODEX_PROTOCOL'));
});

test('process exit rejects all pending requests without exposing stderr', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'exit') { process.stderr.write('private-path secret-value'); process.exit(7); }
  `);
  const first = client.request('hang', {});
  const second = client.request('exit', {});
  await Promise.all([
    assert.rejects(first, transportCode('CODEX_FAILED')),
    assert.rejects(second, transportCode('CODEX_FAILED')),
  ]);
});

test('request timeout and explicit close reject pending requests and future requests', async t => {
  const { client } = await fakeServer(t);
  await assert.rejects(client.request('hang', {}, { timeoutMs: 30 }), transportCode('CODEX_TIMEOUT'));
  await assert.rejects(client.request('echo', {}), transportCode('CODEX_TIMEOUT'));
  const second = await fakeServer(t);
  const pending = second.client.request('hang', {});
  second.client.close();
  await assert.rejects(pending, transportCode('CODEX_CLOSED'));
  let notified = false;
  second.client.onClose(error => { notified = error.code === 'CODEX_CLOSED'; });
  assert.equal(notified, true);
});

test('pending request and event queue bounds fail closed', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'flood') {
    for (let i=0;i<20;i++) send({method:'event',params:i});
    return;
  }
  `, { maxPendingRequests: 1, maxQueuedEvents: 3 });
  const hanging = client.request('hang', {});
  await assert.rejects(client.request('echo', {}), transportCode('CODEX_PROTOCOL'));
  client.close();
  await assert.rejects(hanging, transportCode('CODEX_CLOSED'));
  const flooded = await fakeServer(t, `
  if (message.method === 'flood') { for (let i=0;i<20;i++) send({method:'event',params:i}); return; }
  `, { maxQueuedEvents: 3 });
  flooded.client.subscribe(async () => { await flooded.client.request('hang', {}); });
  await assert.rejects(flooded.client.request('flood', {}), transportCode('CODEX_PROTOCOL'));
});

test('missing binary fails with sanitized unavailable error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-app-server-missing-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const authHome = join(directory, 'managed-auth');
  await mkdir(authHome, { mode: 0o700 });
  await writeFile(join(authHome, 'auth.json'), 'synthetic login fixture', { mode: 0o600 });
  await assert.rejects(createCodexAppServer({ binary: join(directory, 'missing'), cwd: join(directory, 'runtime'), stateDir: join(directory, 'state'), authHome }), transportCode('CODEX_UNAVAILABLE'));
});

test('missing shared credentials fail explicitly without API fallback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-app-server-no-login-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(fakeServer(t, '', { authHome: join(directory, 'no-login-home') }), transportCode('CODEX_AUTH'));
});

test('private managed credentials survive native atomic refresh without being overwritten', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-app-server-refreshed-login-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stateDir = join(directory, 'state');
  await mkdir(join(stateDir, 'home'), { recursive: true, mode: 0o700 });
  const authPath = join(stateDir, 'home', 'auth.json');
  await writeFile(authPath, 'synthetic native refreshed login', { mode: 0o600 });
  const { client } = await fakeServer(t, '', { stateDir, authHome: join(directory, 'missing-original-store') });
  assert.equal((await lstat(authPath)).isFile(), true);
  assert.equal(await readFile(authPath, 'utf8'), 'synthetic native refreshed login');
  assert.equal(await client.request('echo', 'private login retained'), 'private login retained');
});

test('close terminates the isolated process group including descendants', async t => {
  const { client } = await fakeServer(t, `
  if (message.method === 'descendant') {
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
    return reply(message, {pid:child.pid});
  }
  `);
  const { pid } = await client.request<{ pid: number }>('descendant', {});
  const running = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(running(), true);
  client.close();
  for (let attempt = 0; attempt < 50 && running(); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(running(), false);
});
