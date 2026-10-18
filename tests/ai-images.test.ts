import assert from 'node:assert/strict';
import test from 'node:test';
import type OpenAI from 'openai';
import { createAIAsk } from '../server/ai.js';

test('OpenAI adapter sends every image in order while accepting a legacy single image', async () => {
  const requests: unknown[] = [];
  const client = { responses: { create: async (request: unknown) => {
    requests.push(request);
    return { status: 'completed', output_text: '{}' };
  } } } as unknown as OpenAI;
  const ask = createAIAsk('test-key', client);
  assert.ok(ask);
  const imageOne = 'data:image/jpeg;base64,Zmlyc3Q=';
  const imageTwo = 'data:image/png;base64,c2Vjb25k';
  await ask('tutor', 'instructions', { imageOrder: [{ position: 1 }, { position: 2 }] }, [imageOne, imageTwo]);
  await ask('tutor', 'instructions', {}, imageOne);
  const content = (request: unknown) => {
    const input = (request as { input: { content: unknown[] }[] }).input;
    return input[0].content;
  };
  assert.deepEqual(content(requests[0]).slice(1), [
    { type: 'input_image', image_url: imageOne, detail: 'high' },
    { type: 'input_image', image_url: imageTwo, detail: 'high' },
  ]);
  assert.deepEqual(content(requests[1]).slice(1), [
    { type: 'input_image', image_url: imageOne, detail: 'high' },
  ]);
  assert.match((content(requests[0])[0] as { text: string }).text, /imageOrder/);
});
