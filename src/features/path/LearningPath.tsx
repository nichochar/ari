import { useLayoutEffect, useRef } from 'react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/page-header';
import { Markdown } from '../../Markdown';
import { ArrowRight, BookOpen, Check, Plus } from 'lucide-react';
import type { AppState, Difficulty, Exercise } from '../../../shared/types';
import { AriIcon, AriMark, AriSun } from '../../components/ui/ari-mark';
import { Select } from '../../components/ui/select';
import { useLearning } from '../../useLearning';
import type { LearningPathController } from './useLearningPath';
import { LessonConversation } from './LessonConversation';
type LearningPathProps = {
  path: LearningPathController; state: AppState; catalog: Exercise[];
  learning: ReturnType<typeof useLearning>; selectExercise: (id: string) => void;
  openCurriculum: (id: string) => void; openChat: (focusId: string, starter?: string) => void; actionError: string;
};
export function LearningPath({ path, state, catalog, learning, selectExercise, openCurriculum, openChat, actionError }: LearningPathProps) {
  const { activeCurriculum, pathModules, selectedModule, selectedLesson, setSelectedModuleId,
    prepareBusy, prepareLesson, lessonSessions, lessonOutgoing, lessonDrafts, setLessonDrafts,
    sendLessonMessage, deliverLessonMessage, generationBusy, generationDifficulty, setGenerationDifficulty, generateExercise } = path;
  const lessonListRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = lessonListRef.current;
    const row = list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!row || !list) return;
    let active = true;
    const initialScrollTop = list.scrollTop;
    const reveal = () => {
      if (!active || list.scrollTop !== initialScrollTop) return;
      const top = list.getBoundingClientRect().top + list.clientTop;
      const bottom = top + list.clientHeight;
      const bounds = row.getBoundingClientRect();
      if (bounds.top < top) list.scrollTop += bounds.top - top;
      else if (bounds.bottom > bottom) list.scrollTop += bounds.bottom - bottom;
    };
    if (document.fonts.status === 'loaded') reveal();
    else void document.fonts.ready.then(reveal);
    return () => { active = false; };
  }, [selectedModule?.id]);
  return <section className="page">
    <PageHeader title="Learning path" description="Choose a lesson, or explore what you want to learn next." />
    <Button variant="plain" className="learning-chat-entry" onClick={() => { openChat(activeCurriculum?.id || ''); }}><span className="learning-entry-mark"><AriIcon size={25} /></span><span><strong>Talk with Ari</strong><small>Ask a question or shape your next learning path.</small></span>{!!learning.data?.unreadCount && <><i className="unread-dot" aria-hidden="true" /><span className="sr-only">Unread message</span></>}<ArrowRight size={18} /></Button>
    {learning.data && <div className="curriculum-selector"><label htmlFor="curriculum-select">Your curricula</label><Select id="curriculum-select" value={activeCurriculum?.id || ''} onValueChange={openCurriculum} options={learning.data.curricula.map(item => ({ value: item.id, label: item.title }))} /><Button variant="ghost" onClick={() => { openChat('', 'I’d like to learn a new subject. '); }}><Plus size={14} />Explore a new subject</Button></div>}
    <div className="path-layout">
      <Card className="module-list" ref={lessonListRef}>{pathModules.map((module, index) => {
        const lessonExercises = catalog.filter(item => item.moduleId === module.id);
        const lesson = learning.data?.lessons.find(item => item.id === module.id);
        const complete = (!lesson || lesson.status === 'ready')
          && lessonExercises.filter(item => state.progress[item.id]?.status === 'completed').length >= 2;
        return <Button variant="plain" key={module.id}
        aria-pressed={selectedModule?.id === module.id} className={'module-row ' + (selectedModule?.id === module.id ? 'selected' : '')}
        onClick={() => setSelectedModuleId(module.id)}>
        <span className={'subject-mark ' + module.subject}>{module.subject === 'math' ? 'M' : module.subject === 'physics' ? 'P' : <BookOpen size={14} />}</span>
        <span className="module-row-copy"><strong>{module.title}</strong><span className="module-row-meta">
          <small>{activeCurriculum?.source === 'generated' ? `Lesson ${index + 1} · ${lesson?.status || 'planned'}` : `Phase ${module.phase} · ${module.subject}`}</small>
          {complete && <span className="module-complete"><Check size={11} aria-hidden="true" />Complete</span>}
        </span></span>
      </Button>; })}</Card>
      {selectedModule && <Card as="article" className="module-detail"><span className="eyebrow">{activeCurriculum?.source === 'generated' ? `${activeCurriculum.topic} · ${selectedLesson?.status || 'planned'}` : `SHORT LESSON · PHASE ${selectedModule.phase}`}</span>
        <h2>{selectedModule.title}</h2><em>{selectedModule.frenchTitle}</em><p>{selectedModule.summary}</p>
        {selectedLesson && selectedLesson.status !== 'ready' ? <div className="lesson-preparation">{prepareBusy || selectedLesson.status === 'preparing' ? <AriSun size={48} /> : <AriMark size={40} />}<h3>{selectedLesson.status === 'preparing' ? 'Ari is preparing this lesson' : selectedLesson.status === 'failed' ? 'This lesson needs another try' : 'Ready when you are'}</h3><p>{selectedLesson.status === 'preparing' ? 'Its explanation and exercises will appear here. You can leave this page while Ari works.' : 'Ari will prepare this lesson and tailored exercises from your learning path and recent work.'}</p>{selectedLesson.error && <p className="inline-error">{selectedLesson.error}</p>}<Button variant="primary" disabled={prepareBusy || selectedLesson.status === 'preparing'} onClick={() => void prepareLesson()}>{prepareBusy || selectedLesson.status === 'preparing' ? 'Preparing…' : selectedLesson.status === 'failed' ? 'Retry preparation' : 'Prepare lesson'}<ArrowRight size={15} /></Button></div> : <Markdown>{selectedModule.primer}</Markdown>}
        {(!selectedLesson || selectedLesson.status === 'ready') && <>
        <LessonConversation key={selectedModule.id} sessions={lessonSessions} outgoing={lessonOutgoing}
          draft={lessonDrafts[selectedModule.id] || ''}
          onDraft={value => setLessonDrafts(current => ({ ...current, [selectedModule.id]: value }))}
          onSend={sendLessonMessage} onRetry={message => void deliverLessonMessage(message)} />
        <h3>Exercises</h3><div className="exercise-list">{catalog.filter(item => item.moduleId === selectedModule.id).map(item =>
          <Button variant="plain" key={item.id} onClick={() => selectExercise(item.id)}><strong>{item.title}</strong>
            <span>{state.progress[item.id]?.status === 'completed' ? 'Complete' : item.difficulty}</span><ArrowRight size={16} /></Button>)}
        <div className="add-exercise-row">
          <Button variant="plain" className="add-exercise-button" loading={generationBusy} disabled={generationBusy}
            onClick={() => void generateExercise(selectedModule.id, generationDifficulty)}><Plus size={15} />{generationBusy ? 'Adding exercise…' : 'Add exercise'}</Button>
          <Select compact value={generationDifficulty} onValueChange={value => setGenerationDifficulty(value as Difficulty)}
            disabled={generationBusy} aria-label="New exercise difficulty" options={[{ value: 'warmup', label: 'Warmup' }, { value: 'practice', label: 'Practice' }, { value: 'stretch', label: 'Stretch' }]} />
        </div></div>
        {selectedModule.resources.length > 0 && <div className="resources"><h3>Further reading</h3>
          {selectedModule.resources.map(resource => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer">{resource.title} <ArrowRight size={14} /></a>)}
        </div>}
        </>}
      </Card>}
    </div>
    {actionError && <p className="page-error" role="alert">{actionError}</p>}
  </section>;
}
