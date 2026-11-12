import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/page-header';
import { Markdown } from '../../Markdown';
import type { AppState, Exercise } from '../../../shared/types';
import { AriMark, AriSun } from '../../components/ui/ari-mark';
import { useLearning } from '../../useLearning';
import type { LearningPathController } from './useLearningPath';
import { LessonConversation } from './LessonConversation';
import { LessonFiche } from './LessonFiche';
import { LessonPicker } from './LessonPicker';
import { LessonExercises } from './LessonExercises';
import { LessonWorkspace } from './LessonWorkspace';
import { Alert } from '../../components/ui/alert';
import { AppLink } from '../../components/app-link';
import { curriculumPath } from '../../app/routes';
import { CurriculumOverview } from './CurriculumOverview';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';

type LearningPathProps = {
  path: LearningPathController; state: AppState; catalog: Exercise[];
  learning: ReturnType<typeof useLearning>;
  curriculumId?: string; lessonId?: string; openChat: (focusId: string, starter?: string) => void; actionError: string;
};
export function LearningPath({ path, state, catalog, learning, curriculumId, lessonId, openChat, actionError }: LearningPathProps) {
  const { activeCurriculum, selectedModule, selectedLesson, prepareBusy, prepareLesson,
    lessonSessions, lessonOutgoing, lessonDrafts, setLessonDrafts, sendLessonMessage, deliverLessonMessage } = path;
  const ready = !selectedLesson || selectedLesson.status === 'ready';
  if (!lessonId && learning.data) return <CurriculumOverview data={learning.data} path={path} curriculumId={curriculumId}
    explore={() => openChat('', 'I’d like to learn a new subject. ')} />;
  return <section className="page learning-workspace-page">
    <PageHeader title={<Tooltip><TooltipTrigger render={<span className="curriculum-title" tabIndex={0} />}>{activeCurriculum?.title}</TooltipTrigger><TooltipContent>{activeCurriculum?.title}</TooltipContent></Tooltip>}
      actions={<AppLink to="/learn" variant="ghost" size="sm"><ArrowLeft size={15} />All curricula</AppLink>} />
    <div className="lesson-navigation">
      {selectedModule && <LessonPicker path={path} />}
      {activeCurriculum && <AppLink to={curriculumPath(activeCurriculum.id)} variant="ghost" size="sm">All lessons</AppLink>}
    </div>
    {selectedModule && <LessonWorkspace id={selectedModule.id} ready={ready} workspace={path.workspace}
      lesson={<article className="lesson-article">
        <span className="eyebrow">{activeCurriculum?.source === 'generated' ? activeCurriculum.topic : `Phase ${selectedModule.phase} · ${selectedModule.subject}`}</span>
        <h2>{selectedModule.title}</h2>
        {selectedModule.frenchTitle && <p className="lesson-translation">{selectedModule.frenchTitle}</p>}
        <p className="lesson-summary">{selectedModule.summary}</p>
        {selectedLesson && selectedLesson.status !== 'ready' ? <div className="lesson-preparation">{prepareBusy || selectedLesson.status === 'preparing' ? <AriSun size={48} /> : <AriMark size={40} />}<h3>{selectedLesson.status === 'preparing' ? 'Ari is preparing this lesson' : selectedLesson.status === 'failed' ? 'This lesson needs another try' : 'Ready when you are'}</h3><p>{selectedLesson.status === 'preparing' ? 'Its explanation and exercises will appear here. You can leave this page while Ari works.' : 'Ari will prepare this lesson and tailored exercises from your learning path and recent work.'}</p>{selectedLesson.error && <p className="inline-error">{selectedLesson.error}</p>}<Button variant="primary" disabled={prepareBusy || selectedLesson.status === 'preparing'} onClick={() => void prepareLesson()}>{prepareBusy || selectedLesson.status === 'preparing' ? 'Preparing…' : selectedLesson.status === 'failed' ? 'Retry preparation' : 'Prepare lesson'}<ArrowRight size={15} /></Button></div> : <Markdown>{selectedModule.primer}</Markdown>}
      </article>}
      fiche={ready && <LessonFiche key={selectedModule.id} title={selectedModule.title} content={selectedModule.fiche} {...path.ficheRequests[selectedModule.id]}
        onCreate={() => void path.createFiche(selectedModule.id)} onDismiss={() => path.dismissFicheError(selectedModule.id)} />}
      exercises={ready && <LessonExercises path={path} state={state} catalog={catalog} />}
      chat={visible => ready && <LessonConversation key={selectedModule.id} moduleId={selectedModule.id} sessions={lessonSessions} outgoing={lessonOutgoing}
        visible={visible} position={path.workspace.chatPosition(selectedModule.id)}
        draft={lessonDrafts[selectedModule.id] || ''} onDraft={value => setLessonDrafts(current => ({ ...current, [selectedModule.id]: value }))}
        onSend={sendLessonMessage} onRetry={message => void deliverLessonMessage(message)} />}
    />}
    {actionError && <Alert variant="destructive">{actionError}</Alert>}
  </section>;
}
