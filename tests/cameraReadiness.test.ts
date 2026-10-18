import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFrameReady, cameraOperation, nativeFrameReady, waitForCamera } from '../src/cameraReadiness';

test('browser capture requires the current stream, decoded dimensions, and a live video track', () => {
  let readyState = 'live';
  const stream = { getVideoTracks: () => [{ readyState }] } as unknown as MediaStream;
  const videoState = { srcObject: stream, readyState: 1, videoWidth: 1920, videoHeight: 1080 };
  const video = videoState as HTMLVideoElement;
  assert.equal(browserFrameReady(video, stream), false);
  videoState.readyState = 2;
  assert.equal(browserFrameReady(video, stream), true);
  assert.equal(browserFrameReady({ ...video, videoHeight: 0 } as HTMLVideoElement, stream), false);
  assert.equal(browserFrameReady({ ...video, srcObject: {} } as HTMLVideoElement, stream), false);
  readyState = 'ended';
  assert.equal(browserFrameReady(video, stream), false);
});

test('native capture rejects stale, still-decoding, and previous-source images', () => {
  const imageState = { currentSrc: 'blob:previous', complete: true, naturalWidth: 1920, naturalHeight: 1080 };
  const image = imageState as HTMLImageElement;
  assert.equal(nativeFrameReady(image, 'blob:current', 9000, 10000), false);
  imageState.currentSrc = 'blob:current';
  imageState.complete = false;
  assert.equal(nativeFrameReady(image, 'blob:current', 9000, 10000), false);
  imageState.complete = true;
  assert.equal(nativeFrameReady(image, 'blob:current', 9000, 10000), true);
  assert.equal(nativeFrameReady(image, 'blob:current', 4000, 10000), false);
  assert.equal(nativeFrameReady({ ...image, naturalHeight: 0 } as HTMLImageElement, 'blob:current', 9000, 10000), false);
});

test('frame wait reads current readiness until the first decoded frame', async () => {
  let frame: string | null = null;
  const pending = waitForCamera(() => frame, { valid: () => true, timeoutMs: 500, timeoutMessage: 'No frame' });
  setTimeout(() => { frame = 'current frame'; }, 5);
  assert.equal(await pending, 'current frame');
});

test('frame wait times out with actionable error and stops after generation changes', async () => {
  await assert.rejects(waitForCamera(() => null, { valid: () => true, timeoutMs: 1, timeoutMessage: 'Try restarting the camera.' }), /Try restarting/);
  let valid = true;
  const pending = waitForCamera(() => null, { valid: () => valid, timeoutMs: 500, timeoutMessage: 'No frame' });
  valid = false;
  await assert.rejects(pending, { name: 'AbortError' });
});

test('signal cancellation ends both startup waits and frame waits before late success', async () => {
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const startup = cameraOperation(new Promise<string>(resolve => { finish = resolve; }), controller.signal);
  let reads = 0;
  const frame = waitForCamera(() => { reads++; return null; }, { signal: controller.signal, valid: () => true, timeoutMs: 500, timeoutMessage: 'No frame' });
  controller.abort();
  finish('late startup');
  await assert.rejects(startup, { name: 'AbortError' });
  await assert.rejects(frame, { name: 'AbortError' });
  assert.equal(reads, 1);
  await assert.rejects(cameraOperation(Promise.resolve('ready'), controller.signal), { name: 'AbortError' });
});
