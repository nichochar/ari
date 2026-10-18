import assert from 'node:assert/strict';
import test from 'node:test';
import { mainProviderSettings } from '../server/learning-provider-selection.js';

test('main tutor defaults to ChatGPT subscription and Astra regardless of desk model or API key', () => {
  assert.deepEqual(mainProviderSettings({ GENIE_AI_PROVIDER: 'openai', CODEX_MODEL: 'gpt-5.6-sol', OPENAI_API_KEY: 'not-used' }),
    { provider: 'codex', model: 'gpt-6-astra' });
  assert.deepEqual(mainProviderSettings({ CODEX_MAIN_MODEL: 'explicit-model' }), { provider: 'codex', model: 'explicit-model' });
});

test('API billing requires explicit main-provider selection; invalid settings never fall back', () => {
  assert.deepEqual(mainProviderSettings({ GENIE_MAIN_PROVIDER: 'openai', OPENAI_MAIN_MODEL: 'gpt-6-astra' }),
    { provider: 'openai', model: 'gpt-6-astra' });
  assert.throws(() => mainProviderSettings({ GENIE_MAIN_PROVIDER: 'auto' }), /must be codex or openai/);
});
