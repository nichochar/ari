import { createContext, type RefObject } from 'react';
import { readPhoto, type ChatPhotos } from '../photos/useChatPhotos';

export type PlotAsk = (source: string, snapshot: Blob) => void;
export const PlotAskContext = createContext<PlotAsk | null>(null);

export function usePlotAsk({ setDraft, photos, focus }: {
  setDraft: (update: (current: string) => string) => void; photos: ChatPhotos; focus?: RefObject<HTMLTextAreaElement | null>;
}): PlotAsk {
  return (source, snapshot) => {
    const block = '```plot\n' + source + '\n```';
    setDraft(current => current.trim() ? current.trimEnd() + '\n\n' + block : block);
    focus?.current?.focus();
    void readPhoto(new File([snapshot], 'plot.png', { type: 'image/png' }))
      .then(image => photos.add([image]))
      .catch(failure => photos.setError(failure instanceof Error ? failure.message : 'Could not attach this graph.'));
  };
}
