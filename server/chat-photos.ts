import { MAX_CHAT_PHOTOS, MAX_CHAT_PHOTO_SIZE } from '../shared/photos.js';
import type { StateStore } from './state.js';

export function savedPhoto(store: StateStore, id: string): string {
  const photo = store.getSnapshot(id);
  if (!photo) throw new Error('A saved photo is unavailable. Restore it before retrying.');
  return `data:${photo.mimeType};base64,${photo.data.toString('base64')}`;
}

export function photoMessage(store: StateStore, text: string, snapshotIds: string[]) {
  return { role: 'user', content: [
    { type: 'input_text', text },
    ...snapshotIds.map(id => ({ type: 'input_image', image_url: savedPhoto(store, id), detail: 'high' })),
  ] };
}

export function recentPhotos(store: StateStore, snapshotIds: string[], currentImages: string[]) {
  const result: { snapshotId: string; image: string }[] = [];
  let size = currentImages.reduce((sum, image) => sum + image.length, 0);
  for (const snapshotId of [...new Set(snapshotIds)].reverse()) {
    if (result.length + currentImages.length >= MAX_CHAT_PHOTOS) break;
    const image = savedPhoto(store, snapshotId);
    if (size + image.length > MAX_CHAT_PHOTO_SIZE) break;
    result.unshift({ snapshotId, image }); size += image.length;
  }
  return result;
}
