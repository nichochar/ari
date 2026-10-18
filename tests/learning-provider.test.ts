import assert from 'node:assert/strict';
import test from 'node:test';
import type OpenAI from 'openai';
import { createLearningProvider, learningProviderError, type LearningTool } from '../server/learning-provider.js';

const tool: LearningTool = { type: 'function', name: 'find_history', description: 'Find history',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true };
const message = (text: string, annotations: unknown[] = []) => ({ type: 'message', id: 'msg-1', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text, annotations }] });
const completed = (output: unknown[]) => ({ type: 'response.completed', response: { status: 'completed', output,
  usage: { input_tokens: 30, output_tokens: 10 } } });
const events = async function* (...values: unknown[]) { for (const value of values) yield value; };

test('Responses runs Astra high, persists tool calls before execution, and preserves encrypted reasoning', async () => {
  const requests: any[] = [];
  const checkpoints: unknown[][] = [];
  let executions = 0;
  const client = { responses: { create: async (request: any) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) return events(completed([
      { type: 'reasoning', id: 'reason-1', summary: [], encrypted_content: 'opaque-reasoning' },
      { type: 'function_call', call_id: 'call-1', name: 'find_history', arguments: '{}' },
    ]));
    return events({ type: 'response.output_text.delta', delta: 'Remembered.' }, completed([message('Remembered.')]));
  } } } as unknown as OpenAI;
  const provider = createLearningProvider('fixture', client)!;
  const deltas: string[] = [];
  const result = await provider.run({ instructions: 'Tutor instructions', input: [{ role: 'user', content: 'What did I work on?' }], tools: [tool],
    onCheckpoint: context => { checkpoints.push(context); }, onText: delta => { deltas.push(delta); },
    executeTool: async (name, args, id) => {
      assert.equal(name, 'find_history'); assert.equal(id, 'call-1'); assert.deepEqual(args, {});
      assert.equal((checkpoints.at(-1)!.at(-1) as any).type, 'function_call');
      executions++; return { lesson: 'Energy', evidence: 'session-1' };
    } });
  assert.equal(executions, 1);
  assert.equal(result.text, 'Remembered.');
  assert.deepEqual(deltas, ['Remembered.']);
  assert.equal(requests[0].model, 'gpt-6-astra');
  assert.deepEqual(requests[0].reasoning, { effort: 'high' });
  assert.equal(requests[0].store, false);
  assert.ok(requests[0].include.includes('reasoning.encrypted_content'));
  assert.equal(requests[1].input[1].encrypted_content, 'opaque-reasoning');
  assert.equal(requests[1].input[3].call_id, 'call-1');
  assert.ok(requests[0].tools.some((value: any) => value.type === 'web_search'));
  assert.equal(result.output.length, 4);
});

test('restart resumes an outstanding tool call while completed calls are not repeated', async () => {
  let request: any;
  const calls: string[] = [];
  const client = { responses: { create: async (value: any) => { request = structuredClone(value); return events(completed([message('Done.')])); } } } as unknown as OpenAI;
  const provider = createLearningProvider('fixture', client)!;
  await provider.run({ instructions: '', input: [
    { type: 'function_call', name: 'find_history', arguments: '{}', call_id: 'done' },
    { type: 'function_call_output', call_id: 'done', output: '{}' },
    { type: 'function_call', name: 'find_history', arguments: '{}', call_id: 'pending' },
  ], tools: [tool], executeTool: async (_name, _args, id) => { calls.push(id); return { found: true }; } });
  assert.deepEqual(calls, ['pending']);
  assert.equal(request.input.at(-1).call_id, 'pending');
});

test('incomplete streams never checkpoint incomplete output or execute partial tool calls', async () => {
  let checkpoints = 0; let executions = 0;
  const client = { responses: { create: async () => events({ type: 'response.output_text.delta', delta: 'Partial' },
    { type: 'response.incomplete', response: { output: [{ type: 'function_call', name: 'find_history' }] } }) } } as unknown as OpenAI;
  await assert.rejects(createLearningProvider('fixture', client)!.run({ instructions: '', input: [], tools: [tool],
    onCheckpoint: () => { checkpoints++; }, executeTool: async () => { executions++; } }), /did not finish/);
  assert.equal(checkpoints, 0); assert.equal(executions, 0);
});

test('compaction preserves the entire canonical returned window and uses the real compact endpoint', async () => {
  const canonical = [{ role: 'user', content: 'Retained' }, { type: 'compaction', encrypted_content: 'opaque-compacted-state' }];
  let request: any;
  const client = { responses: { compact: async (value: any) => { request = structuredClone(value); return { output: canonical }; } } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.compact([{ role: 'user', content: 'History' }], 'Tutor');
  assert.deepEqual(result, canonical);
  assert.equal(request.model, 'gpt-6-astra'); assert.equal(request.instructions, 'Tutor');
});

test('retrieved photos become image tool output and citation annotations become clickable sources', async () => {
  let request: any;
  const client = { responses: { create: async (value: any) => { request = structuredClone(value); return events(completed([message('Explanation.', [
    { type: 'url_citation', url: 'https://example.com/source', title: 'Source', start_index: 0, end_index: 5 },
  ])])); } } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.run({ instructions: '', tools: [tool],
    input: [{ type: 'function_call', name: 'find_history', arguments: '{}', call_id: 'image' }],
    executeTool: async () => ({ type: 'image_result', text: 'Saved work', images: ['data:image/png;base64,AA=='] }) });
  assert.equal(request.input.at(-1).output[1].type, 'input_image');
  assert.match(result.text, /\[Source\]\(https:\/\/example.com\/source\)/);
});

test('quota and provider failures never expose upstream messages or secrets', () => {
  assert.equal(learningProviderError({ code: 'credit_balance_exhausted', message: 'secret-token' }).code, 'API_CREDITS');
  assert.doesNotMatch(learningProviderError({ status: 401, message: 'secret-token' }).message, /secret-token/);
  assert.doesNotMatch(learningProviderError(new Error('secret-token')).message, /secret-token/);
  assert.equal(createLearningProvider(''), undefined);
});

test('content generation uses structured output and never changes the requested model', async () => {
  let request: any;
  const client = { responses: { create: async (value: any) => { request = structuredClone(value); return { status: 'completed', output_text: '{"title":"A lesson"}' }; } } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.generate('Prepare', { topic: 'Music' }, {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {
      source: { type: 'string', format: 'uri' }, id: { type: 'string', format: 'uuid' },
    },
  });
  assert.deepEqual(result, { title: 'A lesson' });
  assert.equal(request.model, 'gpt-6-astra'); assert.equal(request.text.format.strict, true);
  assert.equal(request.store, false);
  assert.equal(request.text.format.schema.$schema, undefined);
  assert.equal(request.text.format.schema.properties.source.format, undefined);
  assert.equal(request.text.format.schema.properties.id.format, 'uuid');
});

test('a checkpointed final answer is reused after interruption without calling the model again', async () => {
  let calls = 0;
  const client = { responses: { create: async () => { calls++; throw new Error('Must not call'); } } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.run({ instructions: '', tools: [],
    input: [{ role: 'user', content: 'Question' }, message('Already answered.')], executeTool: async () => null });
  assert.equal(calls, 0); assert.equal(result.text, 'Already answered.');
  assert.equal(result.context?.length, 2);
});

test('a checkpointed assistant prelude cannot hide an outstanding tool call', async () => {
  let executions = 0; let requests = 0;
  const client = { responses: { create: async () => { requests++; return events(completed([message('Found the evidence.')])); } } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.run({ instructions: '', tools: [tool],
    input: [{ role: 'user', content: 'Question' },
      { type: 'function_call', call_id: 'pending', name: 'find_history', arguments: '{}' }, message('I will check.')],
    executeTool: async () => { executions++; return { evidence: 'Found' }; } });
  assert.equal(executions, 1); assert.equal(requests, 1);
  assert.equal(result.text, 'I will check.\n\nFound the evidence.');
});

test('completed turn text survives resume from an opaque compaction checkpoint', async () => {
  const savedTexts: (string | undefined)[] = [];
  const client = { responses: { create: async () => events(completed([message('Here is the answer.')])) } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.run({ instructions: '', tools: [],
    input: [{ role: 'user', content: 'Question' }, { type: 'compaction', encrypted_content: 'opaque' }],
    resumeText: 'I found a source.', onCheckpoint: (_context, _tokens, text) => { savedTexts.push(text); }, executeTool: async () => null });
  assert.equal(result.text, 'I found a source.\n\nHere is the answer.');
  assert.equal(savedTexts.at(-1), result.text);
});

test('long tool output compacts at a paired boundary and returns canonical context', async () => {
  const previous = process.env.LEARNING_COMPACTION_TOKENS;
  process.env.LEARNING_COMPACTION_TOKENS = '2000';
  try {
    const requests: any[] = []; let compactions = 0;
    const canonical = [{ role: 'user', content: 'Question' }, { type: 'compaction', encrypted_content: 'opaque' }];
    const client = { responses: {
      compact: async (request: any) => {
        compactions++; assert.equal(request.input.at(-1).type, 'function_call_output');
        return { output: canonical };
      },
      create: async (request: any) => {
        requests.push(structuredClone(request));
        return requests.length === 1 ? events(completed([{ type: 'function_call', call_id: 'large', name: 'find_history', arguments: '{}' }]))
          : events(completed([message('Used the compacted context.')]));
      },
    } } as unknown as OpenAI;
    const result = await createLearningProvider('fixture', client)!.run({ instructions: '', input: [{ role: 'user', content: 'Question' }], tools: [tool], executeTool: async () => ({ evidence: 'a'.repeat(9000) }) });
    assert.equal(compactions, 1); assert.deepEqual(requests[1].input, canonical);
    assert.deepEqual(result.context?.slice(0, 2), canonical);
    assert.equal(result.text, 'Used the compacted context.');
  } finally { if (previous === undefined) delete process.env.LEARNING_COMPACTION_TOKENS; else process.env.LEARNING_COMPACTION_TOKENS = previous; }
});

test('structured tutor refreshes personalization after a tool, keeps chosen model and images, and returns final JSON only', async () => {
  const requests: any[] = [];
  let current = 'USER.md: prefers brief explanations', refreshes = 0;
  const final = '{"feedback":"Draw one diagram."}';
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {
    feedback: { type: 'string', maxLength: 2000 }, source: { type: 'string', format: 'uri' },
  }, required: ['feedback'], additionalProperties: false };
  const workspaceTool = { ...tool, name: 'workspace_write' };
  const client = { responses: { create: async (request: any) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) return events(completed([message('I will save that preference.'),
      { type: 'function_call', call_id: 'save-preference', name: 'workspace_write', arguments: '{"path":"USER.md"}' },
    ]));
    return events(completed([message('The saved preference is current.'), message(final, [{ type: 'url_citation', url: 'https://example.com/diagram', title: 'Diagram', start_index: 0, end_index: 2 }])]));
  } } } as unknown as OpenAI;
  const provider = createLearningProvider('fixture', client, { model: 'gpt-6.1-sol', reasoningEffort: 'medium' })!;
  const result = await provider.run({ instructions: 'Stale preferences',
    refreshInstructions: async () => { refreshes++; return current; }, ephemeral: true, outputSchema: schema,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Use a diagram.' }, { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'high' }] }],
    tools: [workspaceTool], executeTool: async (name, args) => {
      assert.equal(name, 'workspace_write'); assert.deepEqual(args, { path: 'USER.md' });
      current = 'USER.md: prefers diagrams'; return { revision: 2 };
    } });
  assert.equal(refreshes, 2);
  assert.equal(requests[0].instructions, 'USER.md: prefers brief explanations');
  assert.equal(requests[1].instructions, 'USER.md: prefers diagrams');
  for (const request of requests) {
    assert.equal(request.model, 'gpt-6.1-sol'); assert.deepEqual(request.reasoning, { effort: 'medium' });
    assert.equal(request.store, false); assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.schema.$schema, undefined); assert.equal(request.text.format.schema.properties.source.format, undefined);
    assert.equal(request.text.format.schema.properties.feedback.maxLength, 2000);
    assert.equal(request.input[0].content[1].image_url, 'data:image/png;base64,AA==');
  }
  assert.equal(result.text, final, 'commentary and citation prose must not corrupt structured JSON');
  assert.deepEqual(JSON.parse(result.text), { feedback: 'Draw one diagram.' });
  assert.ok(result.context!.some(value => (value as any).type === 'function_call_output'));
  assert.ok(JSON.stringify(result.context).includes('I will save that preference.'), 'canonical context retains commentary');
});

test('structured checkpoint recovery returns the final JSON without earlier commentary or a duplicate request', async () => {
  const final = '{"feedback":"Use the next step."}';
  let requests = 0;
  const client = { responses: { create: async () => { requests++; throw new Error('A completed structured checkpoint must not call the model'); } } } as unknown as OpenAI;
  const result = await createLearningProvider('fixture', client)!.run({ instructions: '', tools: [], outputSchema: {
    type: 'object', properties: { feedback: { type: 'string' } }, required: ['feedback'], additionalProperties: false,
  }, input: [{ role: 'user', content: 'Question' }, message('I will check the evidence.'), message(final)],
  resumeText: 'I will check the evidence.\n\n' + final, executeTool: async () => null });
  assert.equal(requests, 0);
  assert.equal(result.text, final);
  assert.deepEqual(JSON.parse(result.text), { feedback: 'Use the next step.' });
});
