import { useEffect, useMemo, useRef, useState } from 'react';
import { appStorage } from '../../storage';
import { photoLimitError } from '../../../shared/photos';

function read(key: string): string[] {
  try {
    const value: unknown = JSON.parse(appStorage.getItem(key) || '[]');
    return Array.isArray(value) && value.every(image => typeof image === 'string') && !photoLimitError(value) ? value : [];
  } catch { return []; }
}

export function useChatPhotos(owner: string) {
  const key = 'ari:chatPhotos:' + owner;
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setError(''); setBusy(false); }, [key]);
  const images = useMemo(() => drafts[key] ?? read(key), [drafts, key]);
  const current = useRef(images);
  current.current = images;
  function update(next: string[]) {
    current.current = next;
    appStorage.setItem(key, JSON.stringify(next));
    setDrafts(values => ({ ...values, [key]: next }));
  }
  function add(added: string[]) {
    const next = [...current.current, ...added];
    const problem = photoLimitError(next);
    if (problem) { setError(problem); return false; }
    update(next); setError(''); return true;
  }
  return { key, images, add, remove: (index: number) => update(current.current.filter((_, i) => i !== index)),
    clear: () => update([]), error, setError, busy, setBusy };
}
export type ChatPhotos = ReturnType<typeof useChatPhotos>;

export async function readPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (file.size > 15_000_000) throw new Error('Choose a photo under 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not open this photo.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .84);
  } finally { URL.revokeObjectURL(url); }
}
