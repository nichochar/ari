import type { TutorResponse } from '../../../shared/types';
import { Markdown } from '../../Markdown';
import { ChatMessage } from '../chat';
export function TutorBubble({ response, createdAt }: { response: TutorResponse; createdAt: string }) {
  return <ChatMessage author="assistant" createdAt={createdAt}>
    {response.observation && <div className="observation"><strong>What I can see:</strong><Markdown>{response.observation}</Markdown></div>}
    <Markdown>{response.feedback}</Markdown>
    {response.score !== null && <p className="score"><strong>Provisional score: {response.score}</strong></p>}
    {response.criteria.length > 0 && <div className="criteria">{response.criteria.map((item, index) =>
      <div key={item.criterion + index}>
        <div className="criterion-heading"><Markdown>{item.criterion}</Markdown><strong>{item.awarded}/{item.max}</strong></div>
        <Markdown>{item.comment}</Markdown>
      </div>,
    )}</div>}
    {response.nextStep && <div className="next-step"><strong>Next step:</strong><Markdown>{response.nextStep}</Markdown></div>}
    {response.question && <div className="tutor-question"><Markdown>{response.question}</Markdown></div>}
  </ChatMessage>;
}
