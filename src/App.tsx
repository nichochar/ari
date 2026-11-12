import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AppShell } from './app/AppShell';
import { useNavigation, type View } from './app/useNavigation';
import { useRouteState } from './app/useRouteState';
import { usePageScroll } from './app/usePageScroll';
import { assessmentPath, exercisePath, curriculumPath, sectionPaths } from './app/routes';
import { AppLink } from './components/app-link';
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
import { AriSun } from './components/ui/ari-mark';
import { useLearning } from './useLearning';
import { MainConversation } from './Learning';
import { Assessments, useAssessmentList } from './Assessments';

export default function App() {
  const navigation = useNavigation();
  const { view, route, chatFocusId, setChatFocusId, chatStarter, setChatStarter } = navigation;
  const [actionError, setActionError] = useState('');
  const learning = useLearning(route.view === 'chat', !!route.view && route.view !== 'desk' && route.view !== 'assessments');
  const study = useStudy(learning.data, route.view === 'desk' ? route.exerciseId : undefined);
  const assessmentList = useAssessmentList();
  const { state, selectedId, exercise, currentModule, nextExercise, nextLesson } = study;
  const desk = useDesk({ active: route.view === 'desk' && !!route.exerciseId, state, setState: study.setState, exercise, selectedId,
    selectedIdRef: study.selectedIdRef, nativeAvailable: study.nativeAvailable, onIdle: learning.idle, setActionError });
  const path = useLearningPath(study, learning, selectExercise, setActionError, navigation);
  const journal = useJournal(state, study.setState);
  const settings = useSettings(state, study.setState, setActionError);
  const photos = usePhotoViewer();
  const routeState = useRouteState(navigation, study, learning);
  usePageScroll(routeState.ready);
  useEffect(() => { setActionError(''); }, [navigation.location.key]);
  const reflectionSources = useMemo(() => {
    const reflections = new Map(state?.reflections.map(item => [item.id, item]));
    const titles = new Map(study.catalog.map(item => [item.id, item.title]));
    const sources = new Map<string, { id: string; title: string }>();
    for (const note of learning.data?.reflectionNotes ?? []) {
      const reflection = reflections.get(note.reflectionId);
      if (reflection) sources.set(note.messageId, { id: reflection.id, title: titles.get(reflection.exerciseId) || 'Exercise reflection' });
    }
    return sources;
  }, [state?.reflections, study.catalog, learning.data?.reflectionNotes]);
  const memoryRevision = useMemo(() => [
    ...(learning.data?.runs.filter(run => run.status === 'complete').map(run => run.id) ?? []),
    ...(learning.data?.events.filter(event => event.type === 'tool_result' && ['workspace_write', 'workspace_edit', 'workspace_move', 'workspace_delete'].includes(event.name ?? '')).map(event => event.id) ?? []),
  ].join('|'), [learning.data?.runs, learning.data?.events]);
  const learningIdle = useRef(learning.idle);
  learningIdle.current = learning.idle;
  const boundaryRef = useRef({ view, selectedId });
  useEffect(() => {
    const previous = boundaryRef.current;
    if (view === 'desk' && ((previous.view === 'desk' && previous.selectedId !== selectedId) || previous.view === 'assessments')) learningIdle.current();
    boundaryRef.current = { view, selectedId };
  }, [view, selectedId]);

  function selectExercise(id: string) { navigation.go(exercisePath(id)); }
  function showLesson(moduleId: string) { path.showLesson(moduleId); }
  function openCurriculum(id: string) { navigation.go(curriculumPath(id)); }
  function openChat(focusId: string, starter?: string) {
    setChatStarter(starter || '');
    navigation.go('/chat' + (focusId ? '?focus=' + encodeURIComponent(focusId) : ''));
  }
  function navigate(item: View, target = '') {
    navigation.go(target ? sectionPaths[item] + '?' + (item === 'journal' ? 'reflection' : 'message') + '=' + encodeURIComponent(target) : navigation.sectionHref(item));
  }
  if (study.loadError && !state) return <div className="loading-screen">
    <h1>Could not open your desk.</h1><p>{study.loadError}</p>
    <Button variant="primary" onClick={() => void study.load()}>Try again <ArrowRight size={16} /></Button>
  </div>;
  if (!state) return <div className="loading-screen" role="status"><AriSun size={80} /><h1>Preparing your desk…</h1></div>;

  return <AppShell navigation={navigation} learnerName={state.profile.name}
    completed={{
      exercises: Object.values(state.progress).filter(item => item.status === 'completed').length,
      lessons: learning.data ? path.completedLessonIds.size : undefined,
      assessments: assessmentList.completedCount,
    }}
    unreadCount={learning.data?.unreadCount || 0}
    overlays={<><DeskCameraDialog desk={desk} nativeAvailable={study.nativeAvailable} /><PhotoViewer viewer={photos} /></>}>
    {!routeState.ready ? <section className="page"><PageHeader title="Opening Ari…" /><div className="loading-screen page-loading">{learning.error ? <><p>{learning.error}</p><Button onClick={() => void learning.refresh()}>Try again</Button></> : <AriSun size={48} />}</div></section>
      : routeState.problem ? <section className="page"><PageHeader title={routeState.problem} /><AppLink to="/learn" variant="outline">All curricula <ArrowRight size={16} /></AppLink></section>
      : <>
    {view === 'desk' && exercise && <StudyDesk desk={desk} exercise={exercise} currentModule={currentModule}
      nextExercise={nextExercise} nextLesson={nextLesson} tutorReady={!!study.health?.aiConfigured} nativeAvailable={study.nativeAvailable}
      generationBusy={path.generationBusy} generateExercise={path.generateExercise} selectExercise={selectExercise} showLesson={showLesson}
      openPhoto={photos.openPhoto} reflectionNoteId={learning.data?.reflectionNotes?.find(note => note.reflectionId === desk.latestReflection?.id)?.messageId}
      openNote={id => navigate('chat', id)} reviewStatus={journal.reviewStatus} reviewBusy={journal.reviewBusy} actionError={actionError} />}
    {view === 'chat' && <section className="page">
      <MainConversation data={learning.data!} targetMessageId={route.target} reflectionSources={reflectionSources}
        openReflection={id => navigate('journal', id)} pending={learning.pending} deliver={learning.deliver} refresh={learning.refresh} focusId={chatFocusId} setFocusId={setChatFocusId} openCurriculum={openCurriculum} starter={chatStarter} clearStarter={() => setChatStarter('')} />
      {learning.data && learning.error && <p className="inline-error" role="alert">{learning.error}<Button variant="ghost" onClick={() => void learning.refresh()}>Reconnect</Button></p>}
    </section>}
    {view === 'assessments' && <section className="page">
      <Assessments history={assessmentList} curricula={learning.data!.curricula} lessons={learning.data!.lessons} initialCurriculumId={path.activeCurriculum?.id}
        selectedId={route.assessmentId || null} onSelect={id => navigation.go(id ? assessmentPath(id) : '/assessments')} />
    </section>}
    {view === 'path' && <LearningPath path={path} state={state} catalog={study.catalog} learning={learning}
      curriculumId={route.curriculumId} lessonId={route.lessonId} openChat={openChat} actionError={actionError} />}
    {view === 'journal' && <Journal targetReflectionId={route.target} journal={journal} state={state} catalog={study.catalog} allModules={study.allModules}
      selectExercise={selectExercise} showLesson={showLesson} openPhoto={photos.openPhoto} actionError={actionError} />}
    {view === 'settings' && <Settings settings={settings} learning={learning} memoryRevision={memoryRevision}
      discuss={text => openChat('', text)} actionError={actionError} />}
    </>}
  </AppShell>;
}
