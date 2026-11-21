import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeLearningProvider, toClaudeMessages } from '../server/claude-learning-provider.js';
import type { LearningTool } from '../server/learning-provider.js';

const tool: LearningTool = { type: 'function', name: 'find_history', description: 'Find history',
  parameters: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, required: [], additionalProperties: false } };
const claudeMessage = (content: unknown[], stop_reason: string = 'end_turn') => ({
  content, stop_reason, usage: { input_tokens: 30, output_tokens: 10 },
});
const streamOf = (message: unknown, deltas: string[] = []) => ({
  on(_event: string, handler: (text: string) => void) { for (const delta of deltas) handler(delta); return this; },
  finalMessage: async () => message,
});
const fakeClient = (streams: unknown[], creates: any[] = []) => {
  const requests: any[] = [];
  const client = {
    messages: {
      stream: (request: any) => {
        requests.push(structuredClone(request));
        const next = streams.shift() as { message: unknown; deltas?: string[] };
        return streamOf(next.message, next.deltas);
      },
      create: async (request: any) => { requests.push(structuredClone(request)); return creates.shift(); },
    },
  } as unknown as Anthropic;
  return { client, requests };
};

test('Claude turns tool calls into tool_result blocks and keeps the transcript in saved item form', async () => {
  const { client, requests } = fakeClient([
    { message: claudeMessage([{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: 'find_history', input: {} }], 'tool_use') },
    { message: claudeMessage([{ type: 'text', text: 'Remembered.' }]), deltas: ['Remembered.'] },
  ]);
  const checkpoints: unknown[][] = [];
  const deltas: string[] = [];
  let executions = 0;
  const provider = createClaudeLearningProvider({ client, model: 'claude-opus-5-5' })!;
  const result = await provider.run({ instructions: 'Tutor', input: [{ role: 'user', content: 'What did I work on?' }], tools: [tool],
    onCheckpoint: context => { checkpoints.push(context); }, onText: delta => { deltas.push(delta); },
    executeTool: async (name, args, id) => {
      assert.equal(name, 'find_history'); assert.equal(id, 'toolu_1'); assert.deepEqual(args, {});
      executions++; return { lesson: 'Energy' };
    } });

  assert.equal(executions, 1);
  assert.equal(result.text, 'Checking.\n\nRemembered.');
  assert.deepEqual(deltas, ['Remembered.']);
  assert.equal(requests[0].model, 'claude-opus-5-5');
  assert.deepEqual(requests[0].tool_choice, { type: 'auto', disable_parallel_tool_use: true });
  assert.equal(requests[0].tools[0].input_schema.$schema, undefined);
  const followUp = requests[1].messages;
  assert.equal(followUp[1].role, 'assistant');
  assert.equal(followUp[1].content[1].type, 'tool_use');
  assert.equal(followUp[2].role, 'user');
  assert.deepEqual(followUp[2].content[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '{"lesson":"Energy"}' }] });
  assert.equal((checkpoints[0].at(-1) as any).type, 'function_call');
  assert.equal((checkpoints.at(-1)!.at(-1) as any).type, 'message');
});

test('saved history converts to Claude messages, merges same-role turns, and skips non-Claude items', () => {
  const messages = toClaudeMessages([
    { role: 'user', content: 'Look at this' },
    { role: 'user', content: [{ type: 'input_text', text: 'Page 2' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
    { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque' },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Noted.' }] },
    { type: 'compaction', encrypted_content: 'opaque' },
    { role: 'developer', content: 'Ignored' },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal((messages[0].content as any[]).length, 3);
  assert.deepEqual((messages[0].content as any[])[2], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  assert.deepEqual(messages[1], { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] });
});

test('a restart answers only the pending call and does not repeat completed calls', async () => {
  const { client, requests } = fakeClient([{ message: claudeMessage([{ type: 'text', text: 'Done.' }]) }]);
  const calls: string[] = [];
  const provider = createClaudeLearningProvider({ client })!;
  await provider.run({ instructions: '', tools: [tool], input: [
    { type: 'function_call', name: 'find_history', arguments: '{}', call_id: 'done' },
    { type: 'function_call_output', call_id: 'done', output: '{}' },
    { type: 'function_call', name: 'find_history', arguments: '{}', call_id: 'pending' },
  ], executeTool: async (_name, _args, id) => { calls.push(id); return { found: true }; } });
  assert.deepEqual(calls, ['pending']);
  assert.equal(requests[0].messages.at(-1).content[0].tool_use_id, 'pending');
});

test('structured answers are returned as bare JSON even when the model wraps them in a code fence', async () => {
  const { client, requests } = fakeClient([{ message: claudeMessage([{ type: 'text', text: '```json\n{"valid":true,"reason":"ok"}\n```' }]) }]);
  const provider = createClaudeLearningProvider({ client })!;
  const result = await provider.run({ instructions: 'Verify', input: [{ role: 'user', content: 'x' }], tools: [],
    outputSchema: { type: 'object' }, executeTool: async () => ({}) });
  assert.equal(result.text, '{"valid":true,"reason":"ok"}');
  assert.match(requests[0].system, /JSON Schema/);
});

test('generate parses structured content and reports unfinished output', async () => {
  const { client } = fakeClient([], [
    { content: [{ type: 'text', text: '{"valid":true,"reason":"fine"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    { content: [{ type: 'text', text: '{"valid":' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 } },
  ]);
  const provider = createClaudeLearningProvider({ client })!;
  assert.deepEqual(await provider.generate('Verify', { prompt: 'x' }, { type: 'object' }), { valid: true, reason: 'fine' });
  await assert.rejects(provider.generate('Verify', {}, { type: 'object' }), (error: any) => error.code === 'API_INCOMPLETE');
});

test('compaction returns one summary item that keeps the learner context', async () => {
  const { client } = fakeClient([], [{ content: [{ type: 'text', text: 'Learner studies energy.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }]);
  const provider = createClaudeLearningProvider({ client })!;
  const compacted = await provider.compact([{ role: 'user', content: 'History' }], 'Tutor');
  assert.deepEqual(compacted, [{ role: 'user', content: [{ type: 'input_text', text: 'Earlier conversation summary:\nLearner studies energy.' }] }]);
});

test('model list keeps only Claude models the account can use', async () => {
  const client = { messages: {}, models: { list: async function* () { yield { id: 'claude-opus-5-5' }; yield { id: 'claude-haiku-5-5' }; } } } as unknown as Anthropic;
  const models = await createClaudeLearningProvider({ client })!.listModels!();
  assert.deepEqual(models.map(model => model.id), ['claude-opus-5-5', 'claude-haiku-5-5']);
});

test('authorization, credit, and rate-limit failures map to clear learner messages', async () => {
  const failing = (error: unknown) => ({ messages: { stream: () => ({ on() { return this; }, finalMessage: async () => { throw error; } }) } }) as unknown as Anthropic;
  const run = (client: Anthropic) => createClaudeLearningProvider({ client })!.run({ instructions: '', input: [{ role: 'user', content: 'x' }], tools: [], executeTool: async () => ({}) });
  await assert.rejects(run(failing({ status: 401, message: 'invalid x-api-key' })), (error: any) => error.code === 'API_AUTH');
  await assert.rejects(run(failing({ status: 400, message: 'Your credit balance is too low' })), (error: any) => error.code === 'API_CREDITS');
  await assert.rejects(run(failing({ status: 429, message: 'rate limited' })), (error: any) => error.code === 'API_RATE_LIMIT');
});

test('no provider is created without an Anthropic key', () => {
  assert.equal(createClaudeLearningProvider({ apiKey: '' }), undefined);
});
