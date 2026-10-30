import assert from 'node:assert/strict';
import test from 'node:test';
import { api, post, requestJson } from '../src/lib/api.js';

test('JSON requests retain method, headers and cache policy across feature adapters', async t => {
  const requests: Array<{ path: string; options: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    requests.push({ path, options });
    return Response.json({ saved: true });
  });
  assert.deepEqual(await post('/api/profile', { name: 'Learner' }, 'PUT'), { saved: true });
  await requestJson('/api/assessments', { cache: 'no-store' });
  await api('/api/example', { method: 'POST', body: '{}', headers: new Headers({ 'X-Request-Id': 'retry-1' }) });
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(requests[0].options.body, '{"name":"Learner"}');
  assert.equal(new Headers(requests[0].options.headers).get('Content-Type'), 'application/json');
  assert.equal(requests[1].options.method, undefined);
  assert.equal(requests[1].options.cache, 'no-store');
  assert.equal(requests[1].options.signal, undefined);
  assert.equal(new Headers(requests[2].options.headers).get('X-Request-Id'), 'retry-1');
});

test('server errors survive extraction while non-JSON failures keep feature-specific messages', async t => {
  const responses = [
    Response.json({ error: 'This message ID already belongs to another request.' }, { status: 409 }),
    new Response('<html>Unavailable</html>', { status: 503 }),
    Response.json(null, { status: 500 }),
    new Response(null, { status: 204 }),
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  await assert.rejects(post('/api/tutor', { id: 'retry-1' }), /This message ID already belongs/);
  await assert.rejects(requestJson('/api/learning', undefined, { fallbackError: 'Could not save this change. Try again.' }), /Could not save this change/);
  await assert.rejects(api('/api/state'), /Request failed \(500\)/);
  assert.deepEqual(await api('/api/empty'), {});
});

test('request timeout is distinct from caller cancellation and never adds an implicit retry', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      const signal = options.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  await assert.rejects(api('/api/tutor', undefined, 5), /The request timed out. Try again./);
  const controller = new AbortController();
  const request = api('/api/tutor', { signal: controller.signal }, 1000);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(calls, 2);
});
