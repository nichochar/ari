import { useState, type SetStateAction } from 'react';

const empty = { draft: '', uploadedImage: null as string | null, uploadName: '', confidence: null as number | null,
  reflectionNotes: '', sendError: '', reflectionError: '' };
type Draft = typeof empty;

export function useDeskDraft(exerciseId: string) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const current = drafts[exerciseId] ?? empty;
  function setter<K extends keyof Draft>(key: K) {
    return (value: SetStateAction<Draft[K]>) => setDrafts(all => {
      const previous = all[exerciseId] ?? empty;
      return { ...all, [exerciseId]: { ...previous, [key]: typeof value === 'function' ? value(previous[key]) : value } };
    });
  }
  return { ...current, setDraft: setter('draft'), setUploadedImage: setter('uploadedImage'), setUploadName: setter('uploadName'),
    setConfidence: setter('confidence'), setReflectionNotes: setter('reflectionNotes'), setSendError: setter('sendError'), setReflectionError: setter('reflectionError') };
}
