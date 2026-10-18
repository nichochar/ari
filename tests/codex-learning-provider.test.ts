import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../server/state.js';
import { createCodexLearningProvider, isCodexLearningContext, codexLearningContextTokens, type CodexLearningContext } from '../server/codex-learning-provider.js';
import { CodexTransportError, type CodexAppServerClient, type CodexNotification, type CodexServerRequest } from '../server/codex-app-server.js';
import type { LearningAgentRequest, LearningTool } from '../server/learning-provider.js';

type Obj = Record<string, any>;
class FakeCodex implements CodexAppServerClient {
  cwd = '/tmp/ari-codex-provider-test'; threadConfig = { 'mcp_servers.untrusted.enabled': false };
  calls: { method: string; params: Obj }[] = [];
  listeners = new Set<(n: CodexNotification) => void | Promise<void>>();
  closeListeners = new Set<(error: CodexTransportError) => void>();
  requestHandler?: (r: CodexServerRequest) => unknown | Promise<unknown>;
  threads = new Map<string, Obj[]>(); sequence = 0; authType = 'chatgpt';
  actions: ((threadId: string, turn: Obj) => Promise<void>)[] = [];
  compactConfirmed = true;
  async request<T>(method: string, raw: unknown): Promise<T> {
    const p = raw as Obj; this.calls.push({ method, params: structuredClone(p) });
    let result: Obj = {};
    if (method === 'account/read') result = { account: { type: this.authType } };
    if (method === 'thread/start' || method === 'thread/fork') {
      const id = `thread-${++this.sequence}`;
      let inherited = method === 'thread/fork' ? structuredClone(this.threads.get(p.threadId) ?? []) : [];
      if (p.beforeTurnId) inherited = inherited.slice(0, inherited.findIndex(turn => turn.id === p.beforeTurnId));
      this.threads.set(id, inherited);
      result = { thread: { id } };
    }
    if (method === 'thread/turns/list') result = { data: [...(this.threads.get(p.threadId) ?? [])].reverse(), nextCursor: null };
    if (method === 'turn/start' || method === 'thread/compact/start') {
      const turn = { id: `turn-${++this.sequence}`, status: 'inProgress', items: [] as Obj[] };
      this.threads.get(p.threadId)!.push(turn); result = { turn };
      const action = method === 'thread/compact/start'
        ? async () => {
          await this.emit('turn/started', { threadId: p.threadId, turn });
          if (this.compactConfirmed) {
            turn.items.push({ type: 'contextCompaction', id: 'native-compaction' });
            await this.emit('item/completed', { threadId: p.threadId, turnId: turn.id, item: turn.items[0] });
          }
          await this.emit('thread/tokenUsage/updated', { threadId: p.threadId, turnId: turn.id, tokenUsage: { last: { totalTokens: 41 } } });
          turn.status = 'completed'; await this.emit('turn/completed', { threadId: p.threadId, turn });
        }
        : () => (this.actions.shift() ?? this.answer('A useful hint.'))(p.threadId, turn);
      setImmediate(() => { void action().catch(() => {}); });
    }
    return result as T;
  }
  answer(answer: string) {
    return async (threadId: string, turn: Obj) => {
      await this.emit('turn/started', { threadId, turn });
      await this.emit('item/agentMessage/delta', { threadId, turnId: turn.id, itemId: `answer-${turn.id}`, delta: answer });
      const item = { type: 'agentMessage', id: `answer-${turn.id}`, text: answer, phase: 'final_answer' };
      turn.items.push(item);
      await this.emit('item/completed', { threadId, turnId: turn.id, item });
      await this.emit('thread/tokenUsage/updated', { threadId, turnId: turn.id, tokenUsage: { last: { totalTokens: 129 }, total: { totalTokens: 9876 } } });
      turn.status = 'completed'; await this.emit('turn/completed', { threadId, turn });
    };
  }
  async emit(method: string, params: Obj) { for (const listener of [...this.listeners]) await listener({ method, params: structuredClone(params) }); }
  async tool(threadId: string, turnId: string, callId: string, tool: string, args: unknown) {
    const result = await this.requestHandler!({ id: callId, method: 'item/tool/call', params: { threadId, turnId, callId, tool, arguments: args } }) as Obj;
    await this.emit('item/completed', { threadId, turnId, item: { type: 'dynamicToolCall', id: callId, tool, arguments: args, success: result.success, contentItems: result.contentItems } });
    return result;
  }
  notify() {}
  subscribe(listener: (n: CodexNotification) => void | Promise<void>) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onNotification(listener: (n: CodexNotification) => void | Promise<void>) { return this.subscribe(listener); }
  onRequest(listener: (n: CodexServerRequest) => unknown | Promise<unknown>) {
    assert.equal(this.requestHandler, undefined, 'one transport request router'); this.requestHandler = listener;
    return () => { this.requestHandler = undefined; };
  }
  onClose(listener: (e: CodexTransportError) => void) { this.closeListeners.add(listener); return () => { this.closeListeners.delete(listener); }; }
  close() { for (const listener of this.closeListeners) listener(new CodexTransportError('CODEX_CLOSED')); }
}
const tool: LearningTool = { type: 'function', name: 'read_memory', description: 'Read learner memory', parameters: { type: 'object', properties: {} } };
const request = (input: unknown[] = [{ role: 'user', content: 'Help me find the next step.' }]): LearningAgentRequest => ({
  instructions: 'Tutor with brief hints.', input, runKey: 'run-1', tools: [tool], executeTool: async () => ({ content: 'Learning calculus' }),
});
const provider = (client: FakeCodex) => createCodexLearningProvider({ client, cwd: '/tmp/ari-codex-provider-test', timeoutMs: 3000 });

test('persistent Codex run streams text, checkpoints before turn, uses actual last context usage', async () => {
  const c = new FakeCodex(); const p = provider(c); const r = request(); const checkpoints: CodexLearningContext[] = []; let streamed = '';
  r.onCheckpoint = async context => { checkpoints.push(structuredClone(context[0]) as CodexLearningContext); };
  r.onText = delta => { streamed += delta; };
  const result = await p.run(r);
  assert.equal(streamed, 'A useful hint.'); assert.equal(result.text, streamed); assert.equal(result.inputTokens, 129);
  assert.equal(codexLearningContextTokens(result.context!), 129);
  assert.equal(checkpoints[0].state, 'ready'); assert.equal(checkpoints.at(-1)?.state, 'complete');
  assert.ok(isCodexLearningContext(result.context![0]));
  const start = c.calls.find(v => v.method === 'thread/start')!.params;
  assert.equal(start.model, 'gpt-6-astra'); assert.equal(start.historyMode, 'paginated'); assert.equal(start.allowProviderModelFallback, false);
  assert.equal(start.sandbox, 'read-only'); assert.equal(start.approvalPolicy, 'never');
  assert.deepEqual(start.dynamicTools, [{ type: 'function', name: 'read_memory', description: tool.description, inputSchema: tool.parameters }]);
  const turn = c.calls.find(v => v.method === 'turn/start')!.params;
  assert.equal(turn.effort, 'high'); assert.equal(turn.clientUserMessageId, 'run-1');
  assert.equal(c.listeners.size, 0);
});

test('new turn forks committed context and injects proactive assistant messages exactly once', async () => {
  const c = new FakeCodex(); const p = provider(c); const first = await p.run(request());
  const second = await p.run({ ...request([...first.context!, { role: 'assistant', content: 'A saved background observation.' }, { role: 'user', content: 'What follows?' }]), runKey: 'run-2', instructions: 'Updated learner memory revision 2' });
  const fork = c.calls.find(v => v.method === 'thread/fork')!.params;
  assert.equal(fork.threadId, (first.context![0] as CodexLearningContext).threadId);
  assert.match(fork.developerInstructions, /revision 2/);
  assert.equal(c.calls.filter(v => v.method === 'thread/inject_items').length, 1);
  assert.deepEqual(c.calls.find(v => v.method === 'thread/inject_items')!.params.items, [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A saved background observation.' }] }]);
  assert.notEqual((second.context![0] as CodexLearningContext).threadId, fork.threadId);
});

test('durable completed checkpoint is returned without generating a duplicate answer', async () => {
  const c = new FakeCodex(); const p = provider(c); const first = await p.run(request());
  const count = c.calls.filter(v => v.method === 'turn/start').length;
  const recovered = await p.run({ ...request(first.context), resumeText: first.text });
  assert.equal(recovered.text, first.text); assert.equal(c.calls.filter(v => v.method === 'turn/start').length, count);
  assert.equal(c.calls.at(-1)?.method, 'thread/resume');
});

test('native completed turn is recovered after crash between final item and completed checkpoint', async () => {
  const c = new FakeCodex(); const p = provider(c); const r = request(); let saved: unknown[] = [];
  r.onCheckpoint = context => {
    saved = structuredClone(context);
    if ((context[0] as CodexLearningContext).messages.length) throw new Error('simulated database interruption');
  };
  await assert.rejects(p.run(r));
  // Native Codex completes while ARI is unavailable.
  await new Promise(resolve => setImmediate(resolve));
  const count = c.calls.filter(v => v.method === 'turn/start').length;
  const recovered = await p.run(request(saved));
  assert.equal(recovered.text, 'A useful hint.'); assert.equal(c.calls.filter(v => v.method === 'turn/start').length, count);
  assert.equal((recovered.context![0] as CodexLearningContext).state, 'complete');
});

test('tool calls checkpoint before mutation and deduplicate regenerated mutation IDs on interrupted retry', async () => {
  const c = new FakeCodex(); const p = provider(c); let saved: unknown[] = []; let calls = 0; const ids: string[] = [];
  const args = { revision: 2, content: 'Prefers deriving equations.' };
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    const result = await c.tool(threadId, turn.id, 'native-call-1', 'update_memory', args);
    assert.equal(result.success, true); turn.status = 'interrupted';
    await c.emit('turn/completed', { threadId, turn });
  });
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    await c.tool(threadId, turn.id, 'native-call-new', 'update_memory', { content: args.content, revision: args.revision });
    await c.answer('Your preference is saved.')(threadId, turn);
  });
  const r = { ...request(), tools: [{ ...tool, name: 'update_memory' }], onCheckpoint: (context: unknown[]) => { saved = structuredClone(context); },
    executeTool: async (_name: string, _args: unknown, id: string) => {
      assert.equal((saved[0] as CodexLearningContext).tools.at(-1)?.complete, undefined);
      calls++; ids.push(id); return { saved: true };
    } };
  await assert.rejects(p.run(r), { code: 'CODEX_INCOMPLETE' });
  const result = await p.run({ ...r, input: saved });
  assert.equal(result.text, 'Your preference is saved.'); assert.equal(calls, 1); assert.match(ids[0], /^codex:run-1:/);
  assert.equal((result.context![0] as CodexLearningContext).tools[0].complete, true);
  assert.ok(c.calls.filter(v => v.method === 'turn/start')[1].params.input[0].text.includes('interrupted learner response'));
});

test('reads with identical arguments execute again after mutations', async () => {
  const c = new FakeCodex(); const p = provider(c); let calls = 0;
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    await c.tool(threadId, turn.id, 'read-1', 'read_memory', {});
    await c.tool(threadId, turn.id, 'read-2', 'read_memory', {});
    await c.answer('Two fresh reads.')(threadId, turn);
  });
  await p.run({ ...request(), executeTool: async () => ({ revision: ++calls }) });
  assert.equal(calls, 2);
});

test('supported legacy canonical context is imported without silently dropping opaque items', async () => {
  const c = new FakeCodex(); const p = provider(c);
  const old = [{ type: 'compaction', encrypted_content: 'opaque-previous-api-context' },
    { role: 'assistant', content: 'Retained explanation.' }, { role: 'user', content: 'Continue.' }];
  await p.run(request(old));
  const items = c.calls.find(v => v.method === 'thread/inject_items')!.params.items;
  assert.deepEqual(items[0], old[0]); assert.equal(items.length, 2);
  await assert.rejects(p.run(request([{ type: 'unknown_encrypted_state', opaque: 'never forget' }, old[2]])), { code: 'CODEX_CONTEXT_UNSUPPORTED' });
});

test('native compaction forks context, includes proactive messages and confirms native item plus completed turn', async () => {
  const c = new FakeCodex(); const p = provider(c); const first = await p.run(request());
  const result = await p.compact([...first.context!, { role: 'assistant', content: 'New study observation.' }], 'Keep learner instructions current.');
  const marker = result[0] as CodexLearningContext;
  assert.equal(marker.inputTokens, 41); assert.equal(marker.state, 'complete'); assert.equal(marker.messages.length, 0);
  assert.equal(c.calls.filter(v => v.method === 'thread/compact/start').length, 1);
  assert.equal(c.calls.filter(v => v.method === 'thread/inject_items').length, 1);
  assert.notEqual(marker.threadId, (first.context![0] as CodexLearningContext).threadId);
  assert.ok(!c.calls.some(v => 'history' in v.params || 'experimentalRawEvents' in v.params));
});

test('compaction completion without native contextCompaction does not replace committed context', async () => {
  const c = new FakeCodex(); const p = provider(c); const first = await p.run(request()); c.compactConfirmed = false;
  const before = structuredClone(first.context);
  await assert.rejects(p.compact(first.context!, 'Tutoring instructions'), { code: 'COMPACTION_FAILED' });
  assert.deepEqual(first.context, before);
});

test('structured generation uses separate ephemeral Astra high thread with outputSchema', async () => {
  const c = new FakeCodex(); const p = provider(c); const schema = { type: 'object', properties: { hint: { type: 'string' } }, required: ['hint'] };
  c.actions.push(c.answer('{"hint":"Differentiate both sides."}'));
  const value = await p.generate<{ hint: string }>('Write one hint.', { topic: 'calculus' }, schema);
  assert.equal(value.hint, 'Differentiate both sides.');
  const start = c.calls.find(v => v.method === 'thread/start')!.params; assert.equal(start.ephemeral, true); assert.deepEqual(start.dynamicTools, []);
  const turn = c.calls.find(v => v.method === 'turn/start')!.params; assert.deepEqual(turn.outputSchema, schema); assert.equal(turn.effort, 'high');
});

test('ChatGPT sign-in is mandatory; API-key account cannot silently charge API credits', async () => {
  const c = new FakeCodex(); c.authType = 'apiKey'; const p = provider(c);
  await assert.rejects(p.run(request()), { code: 'CODEX_AUTH' });
  assert.equal(c.calls.filter(v => v.method === 'thread/start').length, 0);
});

test('a main tool run and ephemeral generation can share one transport without replacing request handlers', async () => {
  const c = new FakeCodex(); const p = provider(c); let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    await pause;
    const result = await c.tool(threadId, turn.id, 'shared-client-call', 'read_memory', {});
    assert.equal(result.success, true); await c.answer('Main chat finished.')(threadId, turn);
  });
  const main = p.run(request());
  while (!c.calls.some(v => v.method === 'turn/start')) await new Promise(resolve => setImmediate(resolve));
  c.actions.push(c.answer('{"ok":true}'));
  const generation = await p.generate<{ ok: boolean }>('Prepare content.', {}, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] });
  assert.deepEqual(generation, { ok: true });
  release(); assert.equal((await main).text, 'Main chat finished.');
  assert.equal(c.listeners.size, 0);
});

test('compaction before the first chat preserves dynamic tool configuration during legacy migration', async () => {
  const c = new FakeCodex(); const p = createCodexLearningProvider({ client: c, cwd: '/tmp/ari-codex-provider-test', tools: [tool] });
  const compacted = await p.compact([{ role: 'user', content: 'Earlier learner question.' }], 'Tutor instructions.');
  assert.equal(c.calls.find(v => v.method === 'thread/start')!.params.dynamicTools[0].name, 'read_memory');
  await p.run(request([...compacted, { role: 'user', content: 'My next question.' }]));
  assert.equal(c.calls.filter(v => v.method === 'thread/start').length, 1);
  assert.equal(c.calls.filter(v => v.method === 'thread/fork').length, 1);
});

test('marker-only retry without an explicit run key returns its completed saved answer', async () => {
  const c = new FakeCodex(); const p = provider(c); const initial = request(); delete initial.runKey;
  const first = await p.run(initial);
  const retry = { ...initial, input: first.context! };
  const second = await p.run(retry);
  assert.equal(second.text, first.text); assert.equal(c.calls.filter(v => v.method === 'turn/start').length, 1);
});

test('recovery selects a newly completed native continuation if its new turn id was not checkpointed', async () => {
  const c = new FakeCodex(); const p = provider(c); const first = await p.run(request());
  const marker = structuredClone(first.context![0]) as CodexLearningContext;
  marker.state = 'pending'; marker.turnId = 'old-interrupted-turn'; marker.completedTurnId = undefined; marker.messages = [];
  c.threads.get(marker.threadId)!.unshift({ id: marker.turnId, status: 'interrupted', items: [] });
  const count = c.calls.filter(v => v.method === 'turn/start').length;
  const recovered = await p.run(request([marker]));
  assert.equal(recovered.text, 'A useful hint.'); assert.equal(c.calls.filter(v => v.method === 'turn/start').length, count);
});

test('completion arriving before turn/start response remains a completed checkpoint', async () => {
  const c = new FakeCodex(); const original = c.request.bind(c);
  c.request = async <T>(method: string, params: unknown): Promise<T> => {
    const result = await original<T>(method, params);
    if (method === 'turn/start') await new Promise(resolve => setTimeout(resolve, 5));
    return result;
  };
  const result = await provider(c).run(request());
  assert.equal((result.context![0] as CodexLearningContext).state, 'complete');
  assert.equal(result.text, 'A useful hint.');
});

test('timeout interrupts the owned native turn and leaves a retryable saved checkpoint', async () => {
  const c = new FakeCodex(); let saved: unknown[] = [];
  c.actions.push(async (threadId, turn) => { await c.emit('turn/started', { threadId, turn }); });
  const p = createCodexLearningProvider({ client: c, cwd: '/tmp/ari-codex-provider-test', timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(p.run({ ...request(), onCheckpoint: context => { saved = structuredClone(context); } }), { code: 'CODEX_TIMEOUT' });
  } finally { clearTimeout(keepAlive); }
  const interrupted = c.calls.find(v => v.method === 'turn/interrupt')!.params;
  assert.equal(interrupted.threadId, (saved[0] as CodexLearningContext).threadId);
  assert.equal(interrupted.turnId, (saved[0] as CodexLearningContext).turnId);
  assert.equal((saved[0] as CodexLearningContext).state, 'pending');
  assert.equal(c.listeners.size, 0);
});

test('a closed transport is replaced and the existing durable thread is resumed after restart', async () => {
  const first = new FakeCodex(); const second = new FakeCodex(); second.threads = first.threads;
  let instances = 0; let saved: unknown[] = [];
  first.actions.push(async (threadId, turn) => {
    await first.emit('turn/started', { threadId, turn });
    const item = { type: 'agentMessage', id: 'completed-before-restart', text: 'First completed explanation.' };
    turn.items.push(item); await first.emit('item/completed', { threadId, turnId: turn.id, item });
    turn.status = 'interrupted'; first.close();
  });
  const p = createCodexLearningProvider({ cwd: '/tmp/ari-codex-provider-test', clientFactory: async () => ++instances === 1 ? first : second });
  await assert.rejects(p.run({ ...request(), onCheckpoint: context => { saved = structuredClone(context); } }));
  second.sequence = first.sequence;
  const recovered = await p.run(request(saved));
  assert.equal(instances, 2); assert.equal(recovered.text, 'First completed explanation.\n\nA useful hint.');
  assert.equal(second.calls.filter(v => v.method === 'thread/start').length, 0);
  assert.equal(second.calls.filter(v => v.method === 'thread/resume').length, 1);
});

test('an unexpected model selection is rejected before starting a learner turn', async () => {
  const c = new FakeCodex(); const original = c.request.bind(c);
  c.request = async <T>(method: string, params: unknown): Promise<T> => {
    const result = await original<Obj>(method, params);
    return (method === 'thread/start' ? { ...result, model: 'unrequested-other-model' } : result) as T;
  };
  await assert.rejects(provider(c).run(request()), { code: 'CODEX_MODEL' });
  assert.equal(c.calls.filter(v => v.method === 'turn/start').length, 0);
});

for (const alreadyExecuted of [false, true]) test(`interrupted undelivered tool recovery preserves side effect (${alreadyExecuted ? 'after' : 'before'} execution)`, async () => {
  const c = new FakeCodex(); const p = provider(c); const initial = await p.run(request());
  const marker = structuredClone(initial.context![0]) as CodexLearningContext;
  marker.state = 'pending'; marker.completedTurnId = undefined; marker.messages = [];
  marker.tools = [{ callId: 'original-native-call', key: 'stable-mutation-key', name: 'update_memory',
    args: { content: 'Saved learning preference.', revision: 1 },
    ...(alreadyExecuted ? { complete: true, result: { revision: 2, content: 'Saved learning preference.' } } : {}) }];
  let executions = 0;
  c.actions.push(c.answer('The recovered preference is available.'));
  const result = await p.run({ ...request([marker]), tools: [{ ...tool, name: 'update_memory' }], executeTool: async (_name, args, key) => {
    executions++; assert.equal(key, 'stable-mutation-key'); return { revision: 2, ...(args as Obj) };
  } });
  assert.equal(executions, alreadyExecuted ? 0 : 1);
  assert.match(result.text, /recovered preference/);
  const imported = c.calls.find(v => v.method === 'thread/inject_items')!.params.items;
  assert.equal(imported.length, 1); assert.equal(imported[0].type, 'message');
  assert.ok(!imported.some((v: Obj) => v.type === 'function_call_output'), 'never append duplicate raw call outputs');
  const exact = JSON.parse(imported[0].content[0].text.split('\n')[1]);
  assert.deepEqual(exact[0].arguments, marker.tools[0].args);
  assert.equal(exact[0].tool, 'update_memory');
  assert.equal((result.context![0] as CodexLearningContext).tools[0].delivered, true);
  assert.notEqual((result.context![0] as CodexLearningContext).threadId, marker.threadId, 'recovery injection is isolated in an unpublished fork until confirmed');
});

test('structured generation removes unsupported URI formats while retaining schema constraints', async () => {
  const c = new FakeCodex(); const p = provider(c); c.actions.push(c.answer('{"url":"https://example.com"}'));
  await p.generate('Prepare sources.', {}, { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
    properties: { url: { type: 'string', format: 'uri', maxLength: 500 }, date: { type: 'string', format: 'date' } } });
  const schema = c.calls.find(v => v.method === 'turn/start')!.params.outputSchema;
  assert.equal(schema.$schema, undefined); assert.equal(schema.properties.url.format, undefined);
  assert.equal(schema.properties.url.maxLength, 500); assert.equal(schema.properties.date.format, 'date');
});


test('every Codex checkpoint persists through the real StateStore lossless JSON schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-codex-checkpoint-'));
  const dbPath = join(directory, 'state.sqlite'); let store = new StateStore(dbPath);
  try {
    const c = new FakeCodex(); const p = createCodexLearningProvider({ client: c, cwd: directory, tools: [tool] });
    const now = new Date().toISOString(); let checkpointCount = 0;
    await store.updateLearning(data => { data.runs.push({ id: 'run-1', requestId: 'request-1', kind: 'chat', status: 'running', createdAt: now, updatedAt: now }); });
    c.actions.push(async (threadId, turn) => {
      await c.emit('turn/started', { threadId, turn });
      await c.tool(threadId, turn.id, 'persisted-tool', 'read_memory', {});
      await c.answer('The persisted conversation is ready.')(threadId, turn);
    });
    const result = await p.run({ ...request(), executeTool: async () => undefined,
      onCheckpoint: async (context, tokens, completedText) => {
        checkpointCount++;
        if (checkpointCount === 1) {
          assert.ok(!Object.hasOwn(context[0] as Obj, 'completedTurnId'));
          assert.equal((context[0] as CodexLearningContext).state, 'ready');
        }
        await store.updateLearning(data => {
          const run = data.runs[0]; run.context = context; run.contextTokens = tokens;
          if (completedText !== undefined) run.completedText = completedText;
        });
      } });
    assert.ok(checkpointCount >= 6, 'initial, started, tool pending, tool result, delivery, answer and completion checkpoints all validate');
    assert.equal((await store.readLearning()).runs[0].completedText, result.text);
    await store.updateLearning(data => { data.context = result.context!; delete data.runs[0].context; });
    const compacted = await p.compact([{ role: 'user', content: 'Legacy conversation to import and compact.' }], 'Tutor instructions.');
    assert.ok(!Object.hasOwn(compacted[0] as Obj, 'runKey'));
    await store.updateLearning(data => { data.context = compacted; });
    store.close(); store = new StateStore(dbPath);
    assert.deepEqual((await store.readLearning()).context, compacted);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('malformed non-JSON tool arguments fail before a checkpoint or side effect', async () => {
  const c = new FakeCodex(); const p = provider(c); let calls = 0;
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    await c.tool(threadId, turn.id, 'invalid-native-call', 'read_memory', { invalid: undefined });
  });
  await assert.rejects(p.run({ ...request(), executeTool: async () => { calls++; return {}; } }), { code: 'CODEX_PROTOCOL' });
  assert.equal(calls, 0);
});


test('mid-turn model rerouting is rejected and the owned turn is interrupted', async () => {
  const c = new FakeCodex(); const p = provider(c); let streamed = '';
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    await c.emit('model/rerouted', { threadId, turnId: turn.id, fromModel: 'gpt-6-astra', toModel: 'unrequested-fallback', reason: 'availability' });
    await c.answer('Never accept this fallback answer.')(threadId, turn);
  });
  await assert.rejects(p.run({ ...request(), onText: delta => { streamed += delta; } }), { code: 'CODEX_MODEL' });
  assert.equal(streamed, '');
  const interrupted = c.calls.find(v => v.method === 'turn/interrupt')?.params;
  assert.ok(interrupted?.turnId); assert.ok(interrupted?.threadId);
});


test('retry excludes a rejected model turn even if native fallback completed before interruption', async () => {
  const c = new FakeCodex(); const p = provider(c); let saved: unknown[] = [];
  c.actions.push(async (threadId, turn) => {
    await c.emit('turn/started', { threadId, turn });
    await c.emit('model/rerouted', { threadId, turnId: turn.id, fromModel: 'gpt-6-astra', toModel: 'fallback-model', reason: 'availability' });
    await c.answer('Unacceptable fallback answer.')(threadId, turn);
  });
  await assert.rejects(p.run({ ...request(), onCheckpoint: context => { saved = structuredClone(context); } }), { code: 'CODEX_MODEL' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok((saved[0] as CodexLearningContext).rejectedTurnId);
  c.actions.push(c.answer('The requested model answered after retry.'));
  const recovered = await p.run(request(saved));
  assert.equal(recovered.text, 'The requested model answered after retry.');
  const fork = c.calls.find(v => v.method === 'thread/fork')!.params;
  assert.equal(fork.beforeTurnId, (saved[0] as CodexLearningContext).rejectedTurnId);
  assert.ok(!Object.hasOwn(recovered.context![0] as Obj, 'rejectedTurnId'));
});
