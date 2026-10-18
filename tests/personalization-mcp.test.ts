import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkspaceMcpBridge } from '../server/personalization-mcp.js';
import { createCodexAppServer } from '../server/codex-app-server.js';
import { disabledWorkspaceMcpServer } from '../server/codex-learning-provider.js';
import type { LearningTool } from '../server/learning-provider.js';

const tool = (name: string): LearningTool => ({ type: 'function', name, description: 'Synthetic workspace tool', parameters: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } });
type ServerConfig = { command: string; args: string[]; env: { ARI_WORKSPACE_MCP_URL: string; ARI_WORKSPACE_MCP_TOKEN: string }; enabled_tools: string[]; required: boolean; default_tools_approval_mode: string; tools: Record<string, { approval_mode: string }> };
function config(bridge: Awaited<ReturnType<typeof createWorkspaceMcpBridge>>) {
  return (bridge.config.mcp_servers as Record<string, ServerConfig>).ari_workspace;
}

test('workspace MCP bridge authenticates every request and exposes only scoped tool names', async t => {
  const calls: unknown[] = [];
  const bridge = await createWorkspaceMcpBridge([tool('workspace_read'), tool('workspace_write'), tool('complete_onboarding'), tool('shell'), tool('workspace_arbitrary')], async (...args) => { calls.push(args); return { content: 'synthetic note' }; });
  t.after(() => bridge.close());
  const c = config(bridge), url = c.env.ARI_WORKSPACE_MCP_URL;
  const headers = { Authorization: 'Bearer ' + c.env.ARI_WORKSPACE_MCP_TOKEN, 'Content-Type': 'application/json' };
  assert.deepEqual(c.enabled_tools, ['workspace_read', 'workspace_write', 'complete_onboarding']);
  assert.equal(c.required, true);
  assert.equal(c.default_tools_approval_mode, 'prompt');
  assert.deepEqual(c.tools, { workspace_read: { approval_mode: 'approve' }, workspace_write: { approval_mode: 'approve' }, complete_onboarding: { approval_mode: 'approve' } });
  assert.equal((await fetch(url + '/tools')).status, 401);
  assert.equal((await fetch(url + '/tools', { headers: { Authorization: 'Bearer incorrect' } })).status, 401);
  const listed = await (await fetch(url + '/tools', { headers })).json();
  assert.deepEqual(listed.tools.map((item: { name: string }) => item.name), c.enabled_tools);
  assert.equal(listed.tools.find((item: { name: string }) => item.name === 'workspace_read').annotations.readOnlyHint, true);
  assert.equal(listed.tools.find((item: { name: string }) => item.name === 'workspace_write').annotations.readOnlyHint, false);
  assert.equal(listed.tools.find((item: { name: string }) => item.name === 'workspace_write').annotations.openWorldHint, false);
  assert.equal(JSON.stringify(listed).includes(c.env.ARI_WORKSPACE_MCP_TOKEN), false);
  const request = (name: string, args: unknown = { path: 'USER.md' }, callId = 'synthetic-1') => fetch(url + '/call', { method: 'POST', headers, body: JSON.stringify({ name, arguments: args, callId }) });
  assert.equal((await request('shell')).status, 400);
  assert.equal((await request('workspace_arbitrary')).status, 400);
  assert.equal((await request('workspace_read', null)).status, 400);
  assert.equal((await request('workspace_read', {}, '')).status, 400);
  assert.deepEqual(calls, []);
  const result = await request('workspace_read');
  assert.deepEqual(await result.json(), { result: { content: 'synthetic note' } });
  assert.deepEqual(calls, [['workspace_read', { path: 'USER.md' }, 'synthetic-1']]);
  const malformed = await fetch(url + '/call', { method: 'POST', headers, body: 'not JSON' });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(url + '/call', { method: 'POST', headers, body: 'x'.repeat(512 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  await bridge.close();
  await assert.rejects(fetch(url + '/tools', { headers }));
});

test('MCP stdio handshake, call results and errors preserve the scoped dispatcher boundary', async t => {
  const calls: unknown[] = [];
  const bridge = await createWorkspaceMcpBridge([tool('workspace_read'), tool('workspace_edit')], async (name, args, id) => {
    calls.push([name, args, id]);
    if (name === 'workspace_edit') throw new Error('sensitive internal implementation detail');
    return { content: 'A synthetic learner note', revision: 3 };
  });
  t.after(() => bridge.close());
  const c = config(bridge);
  const child = spawn(c.command, c.args, { env: { ...process.env, ...c.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const pending = new Map<number, { resolve(value: Record<string, any>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  createInterface({ input: child.stdout }).on('line', line => {
    const value = JSON.parse(line), entry = pending.get(value.id);
    if (entry) { clearTimeout(entry.timer); pending.delete(value.id); entry.resolve(value); }
  });
  child.stderr.resume();
  function rpc(id: number, method: string, params?: unknown): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Synthetic MCP request timed out.')); }, 5000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
    });
  }
  const hello = await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'synthetic-test', version: '1' } });
  assert.equal(hello.result.protocolVersion, '2024-11-05');
  assert.deepEqual(hello.result.capabilities, { tools: {} });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.deepEqual((await rpc(2, 'tools/list')).result.tools.map((item: { name: string }) => item.name), ['workspace_read', 'workspace_edit']);
  const read = await rpc(3, 'tools/call', { name: 'workspace_read', arguments: { path: 'USER.md' } });
  assert.deepEqual(JSON.parse(read.result.content[0].text), { content: 'A synthetic learner note', revision: 3 });
  assert.equal(calls.length, 1);
  assert.match(String((calls[0] as unknown[])[2]), /^mcp:[a-f0-9-]+:3$/);
  const failed = await rpc(4, 'tools/call', { name: 'workspace_edit', arguments: {} });
  assert.equal(failed.result.isError, true);
  assert.equal(JSON.stringify(failed).includes('sensitive internal'), false);
  const denied = await rpc(5, 'tools/call', { name: 'shell', arguments: {} });
  assert.equal(denied.result.isError, true);
  assert.equal(calls.length, 2);
  assert.equal((await rpc(6, 'unknown/method')).error.code, -32601);
  await bridge.close();
  assert.equal((await rpc(7, 'tools/list')).result.isError, true);
});

test('closing a workspace bridge drains an active mutation before revoking the endpoint', async () => {
  let release!: () => void, entered!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const bridge = await createWorkspaceMcpBridge([tool('workspace_write')], async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { saved: true }; });
  const c = config(bridge);
  const request = fetch(c.env.ARI_WORKSPACE_MCP_URL + '/call', { method: 'POST', headers: { Authorization: 'Bearer ' + c.env.ARI_WORKSPACE_MCP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'workspace_write', arguments: {}, callId: 'synthetic-write' }) });
  await active;
  let closed = false;
  const closing = bridge.close().then(() => { closed = true; });
  assert.equal(closed, false);
  release();
  assert.deepEqual(await (await request).json(), { result: { saved: true } });
  await closing;
  assert.equal(closed, true);
});

// Explicit opt-in: no model requests, credentials read, or application data.
// The native transport reuses managed sign-in via its normal private auth link.
test('native fork discovers new workspace tools and a fresh resume uses a replacement bridge', { skip: !process.env.ARI_TEST_CODEX_BIN }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-native-workspace-mcp-'));
  const first = await createWorkspaceMcpBridge([tool('workspace_read')], async () => ({ generation: 1 }));
  const second = await createWorkspaceMcpBridge([tool('workspace_read')], async () => ({ generation: 2 }));
  const options = { binary: process.env.ARI_TEST_CODEX_BIN, cwd: join(directory, 'cwd'), stateDir: join(directory, 'state'), requestTimeoutMs: 30_000 };
  let client = await createCodexAppServer(options);
  try {
    const settings = { model: 'gpt-6-astra', cwd: client.cwd, approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: 'Synthetic catalog probe. No model turn.', developerInstructions: 'Synthetic protocol test.' };
    const sourceConfig = { ...client.threadConfig, mcp_servers: { ...client.threadConfig.mcp_servers as Record<string, unknown>, ari_workspace: disabledWorkspaceMcpServer() } };
    const source = await client.request<{ thread: { id: string } }>('thread/start', { ...settings, config: sourceConfig, ephemeral: false, historyMode: 'paginated', dynamicTools: [{ name: 'original_tool', description: 'Original synthetic catalog.', inputSchema: { type: 'object', properties: {} } }], allowProviderModelFallback: false });
    assert.ok(source.thread.id, 'native configuration accepts the actual disabled workspace transport stanza');
    const disabledCatalog = await client.request<{ data: { name: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', { threadId: source.thread.id });
    assert.equal(disabledCatalog.data.some(server => server.name === 'ari_workspace' && Object.keys(server.tools).length > 0), false);
    await client.request('thread/inject_items', { threadId: source.thread.id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic learner context retained through the native fork.' }] }] });
    const fork = await client.request<{ thread: { id: string } }>('thread/fork', { ...settings, config: { ...client.threadConfig, ...first.config }, threadId: source.thread.id, excludeTurns: true });
    assert.notEqual(fork.thread.id, source.thread.id);
    const catalog = await client.request<{ data: { name: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', { threadId: fork.thread.id });
    assert.deepEqual(Object.keys(catalog.data.find(server => server.name === 'ari_workspace')!.tools), ['workspace_read']);
    const call = async () => client.request<{ content: { type: string; text: string }[] }>('mcpServer/tool/call', { threadId: fork.thread.id, server: 'ari_workspace', tool: 'workspace_read', arguments: {} });
    assert.deepEqual(JSON.parse((await call()).content[0].text), { generation: 1 });
    // An already-loaded resume retains its original MCP connection. Start a fresh
    // native process before resuming a pending run with a new temporary endpoint.
    client.close(); client = await createCodexAppServer(options);
    await client.request('thread/resume', { ...settings, config: { ...client.threadConfig, ...second.config }, threadId: fork.thread.id, excludeTurns: true });
    assert.deepEqual(JSON.parse((await call()).content[0].text), { generation: 2 });
  } finally {
    client.close(); await first.close(); await second.close(); await rm(directory, { recursive: true, force: true });
  }
});
