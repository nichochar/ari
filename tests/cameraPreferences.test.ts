import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPreferencesKey, readCameraPreferences, saveCameraPreferences } from '../src/cameraPreferences';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem(key: string) { assert.equal(key, cameraPreferencesKey); return value; },
    setItem(key: string, next: string) { assert.equal(key, cameraPreferencesKey); value = next; },
  };
}

test('camera starts clockwise and unmirrored for paper north of the desk', () => {
  assert.deepEqual(readCameraPreferences(memoryStorage()), { rotation: 90, mirrored: false });
});

test('every user rotation and mirror override survives a new preference read', () => {
  const storage = memoryStorage();
  for (const rotation of [0, 90, 180, 270]) {
    for (const mirrored of [false, true]) {
      saveCameraPreferences({ rotation, mirrored }, storage);
      assert.deepEqual(readCameraPreferences(storage), { rotation, mirrored });
    }
  }
});

test('malformed preferences fall back while valid individual controls are retained', () => {
  for (const value of ['{', 'null', '[]', 'true', '"90"', '{"rotation":45,"mirrored":"false"}']) {
    assert.deepEqual(readCameraPreferences(memoryStorage(value)), { rotation: 90, mirrored: false });
  }
  assert.deepEqual(readCameraPreferences(memoryStorage('{"rotation":"270","mirrored":true}')), { rotation: 90, mirrored: true });
  assert.deepEqual(readCameraPreferences(memoryStorage('{"rotation":0,"mirrored":1}')), { rotation: 0, mirrored: false });
});

test('blocked storage does not stop camera controls from working', () => {
  const storage = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage full'); },
  };
  assert.deepEqual(readCameraPreferences(storage), { rotation: 90, mirrored: false });
  assert.doesNotThrow(() => saveCameraPreferences({ rotation: 270, mirrored: true }, storage));
});
