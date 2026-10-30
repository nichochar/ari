import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/page-header';
import { Markdown } from '../../Markdown';
import { ArrowRight } from 'lucide-react';
import type { AppState, Exercise, Module } from '../../../shared/types';
import { AriIcon } from '../../components/ui/ari-mark';
import { ChatMessage } from '../../components/chat';
import { PhotoSet, photoIds, workPhotoLabel, type OpenPhoto } from '../../components/study/photos';
import { TutorBubble } from '../../components/study/TutorBubble';
import { formatDate } from '../../app/date';
import type { JournalController } from './useJournal';
type JournalProps = {
  journal: JournalController; state: AppState; catalog: Exercise[]; allModules: Module[];
  selectExercise: (id: string) => void; showLesson: (id: string) => void; openPhoto: OpenPhoto; actionError: string;
};
export function Journal({ journal, state, catalog, allModules, selectExercise, showLesson, openPhoto, actionError }: JournalProps) {
  const { latestReview, reviewStatus, reviewBusy, runDailyReview } = journal;
  return <section className="page">
        <PageHeader title="Journal" description="Conversations, submitted photos, reflections, and the tutor’s daily review." />
        <div className="journal-grid">
          <Card className="journal-card review-card"><div className="card-heading"><h2>Daily tutor review</h2>
            <Button variant="ghost" loading={reviewBusy} disabled={reviewBusy} onClick={() => void runDailyReview()}>
              {reviewBusy ? 'Reflecting…' : 'Reflect on today'} <AriIcon size={15} /></Button></div>
            {latestReview ? <div><small>{formatDate(latestReview.createdAt)}</small><p>{latestReview.summary}</p>
              <h3>Strengths</h3><ul>{latestReview.strengths.map(item => <li key={item}>{item}</li>)}</ul>
              <h3>Gaps to revisit</h3><ul>{latestReview.gaps.map(item => <li key={item}>{item}</li>)}</ul>
              <h3>Next steps</h3><ul>{latestReview.nextSteps.map(item => <li key={item}>{item}</li>)}</ul>
              {latestReview.memories.length > 0 && <details><summary>What the tutor will remember</summary>
                <ul>{latestReview.memories.map(item => <li key={item}>{item}</li>)}</ul></details>}
              {state.dailyReviews.length > 1 && <details className="older-reviews"><summary>Earlier reviews ({state.dailyReviews.length - 1})</summary>
                {[...state.dailyReviews].filter(item => item.id !== latestReview.id)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => <article className="journal-entry" key={item.id}>
                    <small>{formatDate(item.createdAt)}</small><p>{item.summary}</p>
                    <h3>Strengths</h3><ul>{item.strengths.map(value => <li key={value}>{value}</li>)}</ul>
                    <h3>Gaps</h3><ul>{item.gaps.map(value => <li key={value}>{value}</li>)}</ul>
                    <h3>Next steps</h3><ul>{item.nextSteps.map(value => <li key={value}>{value}</li>)}</ul>
                    {item.memories.length > 0 && <details><summary>What the tutor remembers</summary>
                      <ul>{item.memories.map(value => <li key={value}>{value}</li>)}</ul></details>}
                  </article>)}
              </details>}
            </div> : <p>No daily review yet. Save a reflection, or ask the tutor to reflect on today.</p>}
            {reviewStatus && <p className="status-line" role="status">{reviewStatus}</p>}
          </Card>
          <Card className="journal-card"><h2>Exercise reflections</h2>
            {state.reflections?.length ? [...state.reflections].reverse().map(item => {
              const linked = catalog.find(candidate => candidate.id === item.exerciseId);
              return <article className="journal-entry" key={item.id}>
                <Button variant="plain" className="entry-title" onClick={() => selectExercise(item.exerciseId)}>{linked?.title || item.exerciseId} <ArrowRight size={15} /></Button>
                <small>{formatDate(item.createdAt)} · confidence {item.confidence}/5</small>
                <p>{item.notes || 'No written note for this reflection.'}</p>
                <PhotoSet ids={photoIds(item)} label="Reflection photo" onOpen={openPhoto} />
              </article>;
            }) : <p>Your reflections will appear here after you mark an exercise complete.</p>}
          </Card>
          <Card className="journal-card sessions-card"><h2>Exercise conversations</h2>
            {state.sessions.length ? [...state.sessions].reverse().map(session => {
              const linked = catalog.find(candidate => candidate.id === session.exerciseId);
              return <article className="journal-entry" key={session.id}>
                <Button variant="plain" className="entry-title" onClick={() => selectExercise(session.exerciseId)}>{linked?.title || session.exerciseId} <ArrowRight size={15} /></Button>
                <div className="exchange journal-conversation">
                  <ChatMessage author="user" createdAt={session.createdAt}>
                    <p>{session.requestText || (photoIds(session).length ? workPhotoLabel(photoIds(session).length) : session.mode === 'check' ? 'Grade my work' : 'Question')}</p>
                    <PhotoSet ids={photoIds(session)} label="Submitted work" onOpen={openPhoto} />
                  </ChatMessage>
                  <TutorBubble response={session.response} createdAt={session.createdAt} />
                </div>
              </article>;
            }) : <p>Your exercise conversations will appear here.</p>}
          </Card>
          {!!state.lessonSessions?.length && <Card className="journal-card sessions-card"><h2>Lesson conversations</h2>
            {[...state.lessonSessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(session => {
              const linked = allModules.find(module => module.id === session.moduleId);
              return <article className="journal-entry" key={session.id}>
                <Button variant="plain" className="entry-title" onClick={() => showLesson(session.moduleId)}>{linked?.title || session.moduleId} <ArrowRight size={15} /></Button>
                <div className="exchange journal-conversation">
                  <ChatMessage author="user" createdAt={session.createdAt}><Markdown>{session.requestText}</Markdown></ChatMessage>
                  <TutorBubble response={session.response} createdAt={session.createdAt} />
                </div>
              </article>;
            })}
          </Card>}
        </div>
        {actionError && <p className="page-error" role="alert">{actionError}</p>}
      </section>;
}
