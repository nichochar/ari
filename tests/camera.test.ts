import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JpegStreamParser } from '../server/camera.js';

const jpeg = (...payload: number[]) => Buffer.from([0xff, 0xd8, ...payload, 0xff, 0xd9]);

test('JPEG parser reassembles split markers and keeps the newest complete frame', () => {
  const parser = new JpegStreamParser();
  const first = jpeg(1, 2, 3);
  const second = jpeg(4, 5);
  assert.equal(parser.push(Buffer.from([0, 1, 0xff])), null);
  assert.equal(parser.push(Buffer.from([0xd8, 1, 2])), null);
  assert.deepEqual(parser.push(Buffer.concat([Buffer.from([3, 0xff]), Buffer.from([0xd9]), second])), second);
  assert.deepEqual(parser.push(first), first);
});

test('JPEG parser drops oversized partial frames and recovers', () => {
  const parser = new JpegStreamParser();
  parser.push(Buffer.from([0xff, 0xd8]));
  assert.equal(parser.push(Buffer.alloc(8 * 1024 * 1024 + 1, 7)), null);
  const recovered = jpeg(8, 9);
  assert.deepEqual(parser.push(recovered), recovered);
});
