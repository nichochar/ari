import assert from 'node:assert/strict';
import test from 'node:test';
import { appStorage, createScopedStorage } from '../src/storage.js';

function memoryStorage() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
const firstId = '0caa4e83-a9ec-4c24-af35-22d9a5c405e0';
const secondId = '029c82b8-b106-4116-97b5-7b5ce89d78d3';

test('normal URLs retain existing browser keys and pending drafts', () => {
  const storage = memoryStorage();
  storage.setItem('ari:mainDraft', 'Existing learner draft');
  const normal = createScopedStorage(storage, '?unrelated=value');
  assert.equal(normal.getItem('ari:mainDraft'), 'Existing learner draft');
  normal.setItem('ari:view', 'settings');
  assert.equal(storage.getItem('ari:view'), 'settings');
  normal.removeItem('ari:mainDraft');
  assert.equal(storage.getItem('ari:mainDraft'), null);
});

test('fresh previews isolate pending messages, drafts and navigation from other sessions', () => {
  const storage = memoryStorage();
  storage.setItem('ari:mainPending', '[{"request":{"message":"Existing pending message"}}]');
  storage.setItem('ari:mainDraft', 'Existing learner draft');
  storage.setItem('ari:view', 'desk');
  const first = createScopedStorage(storage, '?onboardingPreview=' + firstId);
  const second = createScopedStorage(storage, '?onboardingPreview=' + secondId);
  for (const key of ['ari:mainPending', 'ari:mainDraft', 'ari:view']) assert.equal(first.getItem(key), null);
  first.setItem('ari:mainDraft', 'Preview draft');
  first.setItem('ari:view', 'chat');
  first.setItem('ari:mainPending', '[]');
  assert.equal(second.getItem('ari:mainDraft'), null);
  assert.equal(storage.getItem('ari:mainDraft'), 'Existing learner draft');
  assert.equal(storage.getItem('ari:view'), 'desk');
  assert.match(storage.getItem('ari:mainPending')!, /Existing pending message/);
  const reopened = createScopedStorage(storage, '?onboardingPreview=' + firstId);
  assert.equal(reopened.getItem('ari:mainDraft'), 'Preview draft');
  assert.equal(reopened.getItem('ari:view'), 'chat');
  reopened.removeItem('ari:mainDraft');
  assert.equal(first.getItem('ari:mainDraft'), null);
  assert.equal(storage.getItem('ari:mainDraft'), 'Existing learner draft');
});

test('only bounded UUID values create namespaces and UUID casing is consistent', () => {
  for (const value of ['', '../other', 'not-a-uuid', 'a'.repeat(1000), firstId + '/extra']) {
    const storage = memoryStorage();
    createScopedStorage(storage, '?onboardingPreview=' + encodeURIComponent(value)).setItem('ari:view', 'desk');
    assert.deepEqual([...storage.entries.keys()], ['ari:view']);
  }
  const storage = memoryStorage();
  createScopedStorage(storage, '?onboardingPreview=' + firstId.toUpperCase()).setItem('ari:view', 'chat');
  assert.equal(createScopedStorage(storage, '?onboardingPreview=' + firstId).getItem('ari:view'), 'chat');
});

test('blocked storage access keeps drafts and deletions available in memory', () => {
  const blocked = createScopedStorage(() => { throw new Error('Storage access denied'); });
  assert.equal(blocked.getItem('ari:mainDraft'), null);
  blocked.setItem('ari:mainDraft', 'Unsaved browser draft');
  assert.equal(blocked.getItem('ari:mainDraft'), 'Unsaved browser draft');
  blocked.removeItem('ari:mainDraft');
  assert.equal(blocked.getItem('ari:mainDraft'), null);
  assert.doesNotThrow(() => appStorage.getItem('ari:view'));
});

test('quota failures retain new values and deletions instead of reviving stale persisted state', () => {
  const storage = memoryStorage();
  storage.setItem('ari:mainDraft', 'Earlier draft');
  storage.setItem('ari:mainPending', 'Earlier pending request');
  const full = createScopedStorage({
    getItem: storage.getItem,
    setItem() { throw new Error('Quota exceeded'); },
    removeItem() { throw new Error('Storage blocked'); },
  });
  assert.equal(full.getItem('ari:mainDraft'), 'Earlier draft');
  full.setItem('ari:mainDraft', 'New draft');
  full.removeItem('ari:mainPending');
  assert.equal(full.getItem('ari:mainDraft'), 'New draft');
  assert.equal(full.getItem('ari:mainPending'), null);
  assert.equal(storage.getItem('ari:mainDraft'), 'Earlier draft');
  assert.equal(storage.getItem('ari:mainPending'), 'Earlier pending request');
});

test('cached reads remain usable when storage becomes blocked without hiding normal external edits', () => {
  const storage = memoryStorage();
  let blocked = false;
  const scoped = createScopedStorage(() => { if (blocked) throw new Error('Storage blocked'); return storage; });
  storage.setItem('ari:mainDraft', 'First draft');
  assert.equal(scoped.getItem('ari:mainDraft'), 'First draft');
  storage.setItem('ari:mainDraft', 'Updated in another tab');
  assert.equal(scoped.getItem('ari:mainDraft'), 'Updated in another tab');
  blocked = true;
  assert.equal(scoped.getItem('ari:mainDraft'), 'Updated in another tab');
});
