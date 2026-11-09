import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { plotInstructions } from '../server/ai.js';
import { createCodexAppServer } from '../server/codex-app-server.js';
import { createCodexLearningProvider, type CodexLearningContext } from '../server/codex-learning-provider.js';

test('native legacy conversation adopts updated instructions and plots across restart and compaction', {
  skip: process.env.ARI_TEST_CODEX_MODEL_TURN !== '1', timeout: 300_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ari-native-instructions-'));
  const options = { model: process.env.CODEX_MAIN_MODEL || 'gpt-6-astra', reasoningEffort: 'high' as const,
    cwd: join(directory, 'cwd'), stateDir: join(directory, 'state'), timeoutMs: 90_000 };
  const oldInstructions = 'You are a tutor. Begin every reply with "Original format." Keep responses short.';
  const original = createCodexLearningProvider({ ...options, clientFactory: async () => {
    const c = await createCodexAppServer({ ...options, binary: process.env.ARI_TEST_CODEX_BIN ?? process.env.CODEX_BIN });
    const request = c.request.bind(c);
    c.request = (method, params, requestOptions) => request(method, method === 'thread/start'
      ? { ...params as object, baseInstructions: 'You are a tutor.', developerInstructions: oldInstructions } : params, requestOptions);
    return c;
  } });
  const upgraded = createCodexLearningProvider(options);
  const executeTool = async () => { throw new Error('No tools in this synthetic test'); };
  const instructions = 'You are a tutor. Begin every reply with "Current format." Keep responses short.\n' + plotInstructions;
  try {
    const first = await original.run({ instructions: oldInstructions, input: [{ role: 'user', content: 'Remember my marker: cobalt.' }],
      tools: [], executeTool, runKey: 'before-upgrade' });
    const legacy = structuredClone(first.context![0]) as CodexLearningContext;
    delete legacy.instructionsHash;
    original.close?.();
    const second = await upgraded.run({ instructions, input: [legacy, { role: 'user', content: 'What is my marker? Plot sin(x).' }],
      tools: [], executeTool, runKey: 'after-upgrade' });
    const check = (text: string) => {
      assert.match(text, /^Current format\./);
      assert.match(text, /cobalt/i);
      assert.match(text, /```plot\s/);
      assert.doesNotMatch(text, /Original format/);
    };
    check(second.text);
    const compacted = await upgraded.compact(second.context!, instructions);
    const third = await upgraded.run({ instructions, input: [...compacted, { role: 'user', content: 'Remind me of my marker and plot cos(x) instead.' }],
      tools: [], executeTool, runKey: 'after-compaction' });
    check(third.text);
  } finally {
    original.close?.(); upgraded.close?.();
    await rm(directory, { recursive: true, force: true });
  }
});
