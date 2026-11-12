import { ArrowRight, Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/page-header';
import { Markdown } from '../../Markdown';
import type { AppState, Exercise } from '../../../shared/types';
import { AriMark, AriSun } from '../../components/ui/ari-mark';
import { Select } from '../../components/ui/select';
import { useLearning } from '../../useLearning';
import type { LearningPathController } from './useLearningPath';
import { LessonConversation } from './LessonConversation';
import { LessonFiche } from './LessonFiche';
import { LessonPicker } from './LessonPicker';
import { LessonExercises } from './LessonExercises';
import { LessonWorkspace } from './LessonWorkspace';
import { Alert } from '../../components/ui/alert';

type LearningPathProps = {
  path: LearningPathController; state: AppState; catalog: Exercise[];
  learning: ReturnType<typeof useLearning>; selectExercise: (id: string) => void;
  openCurriculum: (id: string) => void; openChat: (focusId: string, starter?: string) => void; actionError: string;
};
export function LearningPath({ path, state, catalog, learning, selectExercise, openCurriculum, openChat, actionError }: LearningPathProps) {
  const { activeCurriculum, selectedModule, selectedLesson, prepareBusy, prepareLesson,
    lessonSessions, lessonOutgoing, lessonDrafts, setLessonDrafts, sendLessonMessage, deliverLessonMessage } = path;
  const ready = !selectedLesson || selectedLesson.status === 'ready';
  return <section className="page learning-workspace-page">
    <PageHeader title="Learning path" actions={<Button variant="ghost" size="sm" onClick={() => openChat('', 'I’d like to learn a new subject. ')}><Plus size={14} />Explore a new subject</Button>} />
    <div className="lesson-navigation">
      {learning.data && <Select id="path-curriculum" aria-label="Curriculum" value={activeCurriculum?.id || ''} onValueChange={openCurriculum}
        options={learning.data.curricula.map(item => ({ value: item.id, label: item.title }))} />}
      {selectedModule && <LessonPicker path={path} />}
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
      exercises={ready && <LessonExercises path={path} state={state} catalog={catalog} selectExercise={selectExercise} />}
      chat={visible => ready && <LessonConversation key={selectedModule.id} moduleId={selectedModule.id} sessions={lessonSessions} outgoing={lessonOutgoing}
        visible={visible} position={path.workspace.chatPosition(selectedModule.id)}
        draft={lessonDrafts[selectedModule.id] || ''} onDraft={value => setLessonDrafts(current => ({ ...current, [selectedModule.id]: value }))}
        onSend={sendLessonMessage} onRetry={message => void deliverLessonMessage(message)} />}
    />}
    {actionError && <Alert variant="destructive">{actionError}</Alert>}
  </section>;
}
