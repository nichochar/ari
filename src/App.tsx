import { useEffect, useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { appStorage } from './storage';
import { AppShell } from './app/AppShell';
import { useNavigation, type View } from './app/useNavigation';
import { useStudy } from './app/useStudy';
import { useDesk } from './features/desk/useDesk';
import { StudyDesk } from './features/desk/StudyDesk';
import { DeskCameraDialog } from './features/desk/DeskCamera';
import { useLearningPath } from './features/path/useLearningPath';
import { LearningPath } from './features/path/LearningPath';
import { useJournal } from './features/journal/useJournal';
import { Journal } from './features/journal/Journal';
import { useSettings } from './features/settings/useSettings';
import { Settings } from './features/settings/Settings';
import { PhotoViewer, usePhotoViewer } from './components/study/photos';
import { PageHeader } from './components/page-header';
import { Button } from './components/ui/button';
import { AriMark, AriSun } from './components/ui/ari-mark';
import { useLearning } from './useLearning';
import { MainConversation } from './Learning';
import { Assessments } from './Assessments';
import { useState } from 'react';

export default function App() {
  const navigation = useNavigation();
  const { view, setView, setMobileMenu, chatFocusId, setChatFocusId, chatStarter, setChatStarter, onboardingNavigationChecked } = navigation;
  const [actionError, setActionError] = useState('');
  const learning = useLearning(view === 'chat', view !== 'desk' && view !== 'assessments');
  const study = useStudy(learning.data);
  const { state, selectedId, exercise, currentModule, nextExercise, nextLesson } = study;
  const desk = useDesk({ active: view === 'desk', state, setState: study.setState, exercise, selectedId,
    selectedIdRef: study.selectedIdRef, nativeAvailable: study.nativeAvailable, onIdle: learning.idle, setActionError });
  const path = useLearningPath(study, learning, selectExercise, setActionError);
  const journal = useJournal(state, study.setState);
  const settings = useSettings(state, study.setState, setActionError);
  const photos = usePhotoViewer();
  const memoryRevision = useMemo(() => [
    ...(learning.data?.runs.filter(run => run.status === 'complete').map(run => run.id) ?? []),
    ...(learning.data?.events.filter(event => event.type === 'tool_result' && ['workspace_write', 'workspace_edit', 'workspace_move', 'workspace_delete'].includes(event.name ?? '')).map(event => event.id) ?? []),
  ].join('|'), [learning.data?.runs, learning.data?.events]);
  useEffect(() => {
    if (!learning.data || onboardingNavigationChecked.current) return;
    onboardingNavigationChecked.current = true;
    const onboarding = learning.data.personalization?.onboarding;
    if (onboarding?.status === 'new' && appStorage.getItem('ari:onboardingOpenedAt') !== onboarding.updatedAt) {
      appStorage.setItem('ari:onboardingOpenedAt', onboarding.updatedAt);
      setChatFocusId(''); setView('chat');
    }
  }, [learning.data]);
  const learningIdle = useRef(learning.idle);
  learningIdle.current = learning.idle;
  const boundaryRef = useRef({ view, selectedId });
  useEffect(() => {
    const previous = boundaryRef.current;
    if (view === 'desk' && ((previous.view === 'desk' && previous.selectedId !== selectedId) || previous.view === 'assessments')) learningIdle.current();
    boundaryRef.current = { view, selectedId };
  }, [view, selectedId]);

  function selectExercise(id: string) {
    desk.resetForExercise();
    study.select(id);
    setView('desk');
    setMobileMenu(false);
    setActionError('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showLesson(moduleId: string) {
    desk.cancelCapture();
    desk.invalidateUpload();
    path.showLesson(moduleId);
    setView('path');
  }
  function openCurriculum(id: string) {
    path.openCurriculum(id);
    setView('path');
  }
  function openChat(focusId: string, starter?: string) {
    setChatFocusId(focusId);
    if (starter !== undefined) setChatStarter(starter);
    setView('chat');
  }
  function navigate(item: View) {
    onboardingNavigationChecked.current = true;
    if (item !== 'desk') desk.cancelCapture();
    setView(item);
    setMobileMenu(false);
    setActionError('');
  }
  if (study.loadError && !state) return <div className="loading-screen">
    <h1>Could not open your desk.</h1><p>{study.loadError}</p>
    <Button variant="primary" onClick={() => void study.load()}>Try again <ArrowRight size={16} /></Button>
  </div>;
  if (!state) return <div className="loading-screen" role="status"><AriSun size={80} /><h1>Preparing your desk…</h1></div>;

  return <AppShell navigation={navigation} learnerName={state.profile.name}
    completedCount={Object.values(state.progress).filter(item => item.status === 'completed').length}
    unreadCount={learning.data?.unreadCount || 0} onNavigate={navigate}
    overlays={<><DeskCameraDialog desk={desk} nativeAvailable={study.nativeAvailable} /><PhotoViewer viewer={photos} /></>}>
    {view === 'desk' && exercise && <StudyDesk desk={desk} exercise={exercise} currentModule={currentModule}
      nextExercise={nextExercise} nextLesson={nextLesson} tutorReady={!!study.health?.aiConfigured} nativeAvailable={study.nativeAvailable}
      generationBusy={path.generationBusy} generateExercise={path.generateExercise} selectExercise={selectExercise} showLesson={showLesson}
      openPhoto={photos.openPhoto} reviewStatus={journal.reviewStatus} reviewBusy={journal.reviewBusy} actionError={actionError} />}
      {view === 'chat' && <section className="page">
        {learning.data ? <MainConversation data={learning.data} pending={learning.pending} deliver={learning.deliver} refresh={learning.refresh} focusId={chatFocusId} setFocusId={setChatFocusId} openCurriculum={openCurriculum} starter={chatStarter} clearStarter={() => setChatStarter('')} />
          : <><PageHeader title="Talk with Ari" /><div className="loading-screen page-loading" role={learning.error ? undefined : 'status'}>
            {learning.error ? <AriMark size={40} /> : <AriSun size={72} />}
            <h2>{learning.error ? 'Could not open your conversation' : 'Opening your conversation…'}</h2>
            {learning.error && <><p>{learning.error}</p><Button variant="secondary" onClick={() => void learning.refresh()}>Try again</Button></>}
          </div></>}
        {learning.data && learning.error && <p className="inline-error" role="alert">{learning.error}<Button variant="ghost" onClick={() => void learning.refresh()}>Reconnect</Button></p>}
      </section>}
      {view === 'assessments' && <section className="page">
        {learning.data ? <Assessments curricula={learning.data.curricula} lessons={learning.data.lessons} initialCurriculumId={path.activeCurriculum?.id} />
          : <><PageHeader title="Assessments" /><div className="loading-screen page-loading" role={learning.error ? 'alert' : 'status'}>
            {learning.error ? <><p>{learning.error}</p><Button variant="secondary" onClick={() => void learning.refresh()}>Try again</Button></> : <AriSun size={72} />}
          </div></>}
      </section>}
    {view === 'path' && <LearningPath path={path} state={state} catalog={study.catalog} learning={learning}
      selectExercise={selectExercise} openCurriculum={openCurriculum} openChat={openChat} actionError={actionError} />}
    {view === 'journal' && <Journal journal={journal} state={state} catalog={study.catalog} allModules={study.allModules}
      selectExercise={selectExercise} showLesson={showLesson} openPhoto={photos.openPhoto} actionError={actionError} />}
    {view === 'settings' && <Settings settings={settings} learning={learning} memoryRevision={memoryRevision}
      discuss={text => openChat('', text)} actionError={actionError} />}
  </AppShell>;
}
