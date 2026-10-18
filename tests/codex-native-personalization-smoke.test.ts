import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodexAppServer, type CodexAppServerClient } from '../server/codex-app-server.js';
import { createCodexLearningProvider, type CodexLearningContext } from '../server/codex-learning-provider.js';
import type { LearningTool } from '../server/learning-provider.js';

// Explicit opt-in: runs two actual model turns against the configured ChatGPT
// Codex model. Uses synthetic notes and isolated native state, never the app DB.
test('native model preserves old context while newly added workspace read and write tools use the MCP bridge', {
  skip: process.env.ARI_TEST_CODEX_MODEL_TURN !== '1', timeout: 180_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-native-model-workspace-'));
  const methods: string[] = [];
  const nativeItems = new Set<string>(), inboundMethods = new Set<string>();
  const mcpOutcomes: unknown[] = [];
  let transport: CodexAppServerClient | undefined;
  let workspaceReads = 0, workspaceWrites = 0;
  let savedNote = 'The synthetic note word is willow.';
  const model = process.env.CODEX_MAIN_MODEL || 'gpt-6-astra';
  const oldTool: LearningTool = { type: 'function', name: 'read_memory', description: 'Read synthetic learner notes.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } };
  const workspaceTool: LearningTool = { type: 'function', name: 'workspace_read', description: 'Read the synthetic note at the given relative workspace path.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } };
  const writeTool: LearningTool = { type: 'function', name: 'workspace_write', description: 'Save synthetic workspace note content at a relative path.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } };
  const provider = createCodexLearningProvider({ model, reasoningEffort: 'high', cwd: join(directory, 'cwd'), stateDir: join(directory, 'state'), timeoutMs: 75_000,
    clientFactory: async () => {
      const native = await createCodexAppServer({ binary: process.env.ARI_TEST_CODEX_BIN ?? process.env.CODEX_BIN,
        cwd: join(directory, 'cwd'), stateDir: join(directory, 'state'), requestTimeoutMs: 75_000 });
      transport = native;
      const request = native.request.bind(native);
      native.request = async <T>(method: string, params: unknown, options?: { timeoutMs?: number }) => { methods.push(method); return request<T>(method, params, options); };
      native.subscribe(event => {
        const item = (event.params as { item?: { type?: string; server?: string; tool?: string; name?: string; status?: unknown; arguments?: unknown; result?: unknown; error?: unknown } })?.item;
        if (item?.type) nativeItems.add([item.type, item.server, item.tool, item.name].filter(value => typeof value === 'string').join(':'));
        if (item?.type === 'mcpToolCall' && event.method === 'item/completed') mcpOutcomes.push({ status: item.status, arguments: item.arguments, result: item.result, error: item.error });
      });
      const onRequest = native.onRequest.bind(native);
      native.onRequest = callback => onRequest(rpc => { inboundMethods.add(rpc.method); return callback(rpc); });
      return native;
    } });
  try {
    const first = await provider.run({ instructions: 'This is an isolated synthetic tutor integration test. Answer tersely and retain the learner’s marker in this conversation.',
      input: [{ role: 'user', content: 'Remember my synthetic marker word: cobalt. Reply with just that word.' }],
      tools: [oldTool], runKey: 'synthetic-original-catalog', executeTool: async () => ({ content: 'Synthetic learner notes only.' }) });
    assert.match(first.text.toLowerCase(), /\bcobalt\b/);
    const original = first.context![0] as CodexLearningContext;
    assert.deepEqual(original.dynamicToolNames, ['read_memory']);
    const second = await provider.run({ instructions: 'This is an isolated synthetic tutor integration test. Read the specified workspace note with workspace_read before answering. Preserve the previous conversation; reply tersely.',
      input: [...first.context!, { role: 'user', content: 'Use workspace_read for memories/check.md. Then use workspace_write to save its word to memories/result.md. Tell me its word and the previous marker word I gave you. Reply with only those two words.' }],
      tools: [oldTool, workspaceTool, writeTool], runKey: 'synthetic-upgraded-catalog', executeTool: async (name, args) => {
        if (name === 'read_memory') return { content: 'Synthetic learner notes only.' };
        if (name === 'workspace_write') {
          const write = args as { path: string; content: string };
          assert.equal(write.path, 'memories/result.md'); assert.match(write.content.toLowerCase(), /willow/);
          workspaceWrites++; savedNote = write.content; return { path: write.path, saved: true };
        }
        assert.equal(name, 'workspace_read'); assert.deepEqual(args, { path: 'memories/check.md' });
        workspaceReads++; return { path: 'memories/check.md', content: savedNote };
      } });
    if (!workspaceReads || !workspaceWrites) {
      const catalog = await transport!.request<{ data: { name: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', { threadId: (second.context![0] as CodexLearningContext).threadId });
      console.info('Synthetic upgrade response:', second.text.slice(0, 800));
      console.info('Synthetic workspace catalog:', catalog.data.filter(server => server.name === 'ari_workspace').map(server => Object.keys(server.tools)));
      console.info('Synthetic native item types/tool names:', [...nativeItems]);
      console.info('Synthetic native outgoing RPC methods:', [...new Set(methods)]);
      console.info('Synthetic native incoming RPC methods:', [...inboundMethods]);
      console.info('Synthetic MCP outcomes:', JSON.stringify(mcpOutcomes).replace(/[a-f0-9]{64}/gi, '[redacted]').slice(0, 4000));
    }
    assert.ok(workspaceReads > 0, 'new read tool must execute through the MCP callback');
    assert.ok(workspaceWrites > 0, 'scoped mutation must execute through the MCP callback without falsely claiming read-only access');
    assert.match(savedNote.toLowerCase(), /willow/);
    assert.match(second.text.toLowerCase(), /\bcobalt\b/);
    assert.match(second.text.toLowerCase(), /\bwillow\b/);
    const upgraded = second.context![0] as CodexLearningContext;
    assert.notEqual(upgraded.threadId, original.threadId);
    assert.deepEqual(upgraded.dynamicToolNames, ['read_memory'], 'new tools use MCP without replacing the native catalog');
    assert.equal(methods.filter(method => method === 'thread/start').length, 1);
    assert.equal(methods.filter(method => method === 'thread/fork').length, 1);
    assert.equal(methods.filter(method => method === 'thread/inject_items').length, 0, 'native context is never reconstructed');
    const resumed = await provider.run({ instructions: 'Synthetic checkpoint recovery.', input: second.context!, tools: [oldTool, workspaceTool, writeTool],
      runKey: 'synthetic-upgraded-catalog', executeTool: async () => { throw new Error('Completed smoke must not rerun a tool'); } });
    assert.equal(resumed.text, second.text);
    assert.equal(methods.filter(method => method === 'turn/start').length, 2, 'completed context recovery makes no extra model turn');
    console.info(`Synthetic native smoke passed: ${model} / high; workspace reads ${workspaceReads}, writes ${workspaceWrites}; previous cobalt + retrieved willow; native fork without reconstruction; completed context recovered.`);
  } finally {
    transport?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
