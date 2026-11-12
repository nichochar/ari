import { useChatPhotos } from '../../components/photos/useChatPhotos';
import { PhotoSet, PhotoViewer, usePhotoViewer } from '../../components/study/photos';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LessonSession } from '../../../shared/types';
import type { OutgoingLessonMessage } from './useLearningPath';
import type { ChatPosition } from './useLessonWorkspace';
import { Button } from '../../components/ui/button';
import { AriIcon } from '../../components/ui/ari-mark';
import { ChatComposer, ChatMessage, ChatWaiting } from '../../components/chat';
import { Markdown } from '../../Markdown';
import { TutorBubble } from '../../components/study/TutorBubble';
import { PlotAskContext, usePlotAsk } from '../../components/plot/ask';
export function LessonConversation({ moduleId, sessions, outgoing, draft, onDraft, onSend, onRetry, visible, position }: {
  moduleId: string; sessions: LessonSession[]; outgoing: OutgoingLessonMessage[]; draft: string;
  onDraft: (value: string) => void; onSend: (images: string[]) => boolean;
  onRetry: (message: OutgoingLessonMessage) => void;
  visible: boolean; position: ChatPosition;
}) {
  const photos = useChatPhotos('lesson:' + moduleId);
  const viewer = usePhotoViewer();
  const paneRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const askPlot = usePlotAsk({ setDraft: update => onDraft(update(draft)), photos, focus: composerRef });
  const latestOutgoing = outgoing.at(-1)?.id;
  const entries = [
    ...sessions.map(session => ({ id: session.id, createdAt: session.createdAt, session, outgoing: undefined })),
    ...outgoing.filter(item => !sessions.some(session => session.id === item.id))
      .map(message => ({ id: message.id, createdAt: message.createdAt, session: undefined, outgoing: message })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => { if (latestOutgoing) position.following = true; }, [latestOutgoing, position]);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane && visible) pane.scrollTop = position.following ? pane.scrollHeight : position.top;
  }, [sessions, outgoing, visible, position]);
  const pending = outgoing.length > 0;
  return <PlotAskContext.Provider value={askPlot}><section className="conversation-panel lesson-conversation" aria-label="Lesson chat">
    <div className="conversation" ref={paneRef} role="log" aria-label="Lesson conversation" aria-live="polite" aria-relevant="additions text"
      onScroll={event => { if (!visible) return; const node = event.currentTarget; position.top = node.scrollTop; position.following = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
      {entries.length ? entries.map(entry => <div className={'exchange ' + (entry.outgoing ? 'outgoing-exchange' : '')} key={entry.id}>
        <ChatMessage author="user" createdAt={entry.createdAt} arriving={!!entry.outgoing}>
          <Markdown>{entry.session ? entry.session.requestText : entry.outgoing!.request.message}</Markdown>
          <PhotoSet ids={entry.session?.snapshotIds || entry.outgoing?.request.images || []} label="Message photo" onOpen={viewer.openPhoto} />
        </ChatMessage>
        {entry.session ? <TutorBubble response={entry.session.response} createdAt={entry.session.createdAt} />
          : entry.outgoing?.status === 'sending' ? <ChatWaiting /> : entry.outgoing && <div className="message-error" role="alert"><p>{entry.outgoing.error}</p>
            <Button variant="ghost" onClick={() => onRetry(entry.outgoing!)}><RefreshCw size={14} /> Retry message</Button>
          </div>}
      </div>) : <div className="conversation-empty"><AriIcon size={20} /><p>Ask about this lesson.</p></div>}
    </div>
    <ChatComposer value={draft} onChange={onDraft} onSend={() => { if (onSend(photos.images)) photos.clear(); }} sendDisabled={pending || (!draft.trim() && !photos.images.length)}
      photos={photos} photosDisabled={pending} inputRef={composerRef}
      label="Question about this lesson" placeholder="What would you like to understand?" maxLength={4000} />
    <PhotoViewer viewer={viewer} />
  </section></PlotAskContext.Provider>;
}
