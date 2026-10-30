import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LessonSession } from '../../../shared/types';
import type { OutgoingLessonMessage } from './useLearningPath';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { AriIcon } from '../../components/ui/ari-mark';
import { ChatComposer, ChatMessage, ChatWaiting } from '../../components/chat';
import { Markdown } from '../../Markdown';
import { TutorBubble } from '../../components/study/TutorBubble';
export function LessonConversation({ sessions, outgoing, draft, onDraft, onSend, onRetry }: {
  sessions: LessonSession[]; outgoing: OutgoingLessonMessage[]; draft: string;
  onDraft: (value: string) => void; onSend: () => void;
  onRetry: (message: OutgoingLessonMessage) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const latestOutgoing = outgoing.at(-1)?.id;
  const entries = [
    ...sessions.map(session => ({ id: session.id, createdAt: session.createdAt, session, outgoing: undefined })),
    ...outgoing.filter(item => !sessions.some(session => session.id === item.id))
      .map(message => ({ id: message.id, createdAt: message.createdAt, session: undefined, outgoing: message })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => { if (latestOutgoing) followRef.current = true; }, [latestOutgoing]);
  useEffect(() => {
    const pane = paneRef.current;
    if (pane && followRef.current) pane.scrollTop = pane.scrollHeight;
  }, [sessions, outgoing]);
  const pending = outgoing.length > 0;
  return <Card className="conversation-panel lesson-conversation">
    <div className="conversation" ref={paneRef} role="log" aria-label="Lesson conversation" aria-live="polite" aria-relevant="additions text"
      onScroll={event => { const node = event.currentTarget; followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
      {entries.length ? entries.map(entry => <div className={'exchange ' + (entry.outgoing ? 'outgoing-exchange' : '')} key={entry.id}>
        <ChatMessage author="user" createdAt={entry.createdAt} arriving={!!entry.outgoing}>
          <Markdown>{entry.session ? entry.session.requestText : entry.outgoing!.request.message}</Markdown>
        </ChatMessage>
        {entry.session ? <TutorBubble response={entry.session.response} createdAt={entry.session.createdAt} />
          : entry.outgoing?.status === 'sending' ? <ChatWaiting /> : entry.outgoing && <div className="message-error" role="alert"><p>{entry.outgoing.error}</p>
            <Button variant="ghost" onClick={() => onRetry(entry.outgoing!)}><RefreshCw size={14} /> Retry message</Button>
          </div>}
      </div>) : <div className="conversation-empty"><AriIcon size={20} /><p>Ask about this lesson.</p></div>}
    </div>
    <ChatComposer value={draft} onChange={onDraft} onSend={onSend} sendDisabled={pending || !draft.trim()}
      label="Question about this lesson" placeholder="What would you like to understand?" maxLength={4000} />
  </Card>;
}
