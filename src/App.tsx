import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BookOpen, Camera, Check, CheckCircle2, Download, Expand,
  History, Menu, Minimize, Pause, Plus, RefreshCw, RotateCw, Send, Settings2,
  LampDesk, Target, Upload, X,
} from 'lucide-react';
import { Markdown } from './Markdown';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Select } from './components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './components/ui/dialog';
import { Slider } from './components/ui/slider';
import { FileUpload } from './components/ui/file-upload';
import { LampLoader } from './components/ui/lamp-loader';
import { diagnosticIds, exercises, modules } from '../shared/curriculum';
import type {
  AppState, DailyReview, Difficulty, Exercise, ExercisePage, Health, LessonChatRequest, LessonSession, Module, Profile,
  ReflectionResponse, Session, StudyPlan, TutorRequest, TutorResponse,
} from '../shared/types';
import { MAX_EXERCISE_PAGES } from '../shared/types';
import { useCamera } from './useCamera';
import { useLearning, learningApi, learningError } from './useLearning';
import { MainConversation, LearnerMemoryEditor } from './Learning';

type View = 'desk' | 'path' | 'journal' | 'settings' | 'chat';
type TutorMode = 'chat' | 'check';
type OutgoingMessage = {
  id: string; createdAt: string; request: TutorRequest;
  pageSnapshotIds: string[];
  status: 'sending' | 'failed' | 'saved'; error?: string; response?: TutorResponse;
};
type UnsavedPage = { id: string; image: string; error: string };
type OutgoingLessonMessage = {
  id: string; createdAt: string; request: LessonChatRequest;
  status: 'sending' | 'failed'; error?: string;
};
const curated = exercises as Exercise[];
const courseModules = modules as Module[];
const selectedKey = 'ari:selectedExerciseId';
const sidebarKey = 'ari:sidebarCollapsed';
const viewKey = 'ari:view';
const moduleKey = 'ari:selectedModuleId';
const labels: Record<View, string> = {
  desk: 'Study desk', path: 'Learning path', journal: 'Journal', settings: 'Settings', chat: 'Talk with ARI',
};

async function api<T>(path: string, options?: RequestInit, timeout = 180000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      ...options, signal: controller.signal,
      headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed (' + response.status + ').');
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The request timed out. Try again.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function post<T>(path: string, body: unknown, method = 'POST') {
  return api<T>(path, { method, body: JSON.stringify(body) }, 210000);
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function localDay() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function navIcon(view: View) {
  if (view === 'desk') return <BookOpen size={19} />;
  if (view === 'chat') return <LampDesk size={19} />;
  if (view === 'path') return <Target size={19} />;
  if (view === 'journal') return <History size={19} />;
  return <Settings2 size={19} />;
}
function Snapshot({ id, label, onOpen }: {
  id: string; label: string; onOpen: (id: string, opener: HTMLButtonElement) => void;
}) {
  return <Button variant="plain" className="snapshot-thumb" onClick={event => onOpen(id, event.currentTarget)} aria-label={'Expand ' + label}>
    <img src={photoSource(id)} alt={label} loading="lazy" />
    <span><Expand size={14} /> View photo</span>
  </Button>;
}
function photoSource(id: string) {
  return id.startsWith('data:image/') ? id : '/api/snapshots/' + encodeURIComponent(id);
}
function photoIds(record: { snapshotId?: string; snapshotIds?: string[] }) {
  return record.snapshotIds?.length ? record.snapshotIds : record.snapshotId ? [record.snapshotId] : [];
}
function PhotoSet({ ids, label, onOpen }: {
  ids: string[]; label: string; onOpen: (id: string, opener: HTMLButtonElement) => void;
}) {
  return ids.length > 0 && <div className="photo-set">{ids.map((id, index) =>
    <Snapshot key={id + index} id={id} label={`${label} ${index + 1} of ${ids.length}`} onOpen={onOpen} />,
  )}</div>;
}
function TutorBubble({ response }: { response: TutorResponse }) {
  return <div className="chat-bubble assistant-bubble">
    <span className="bubble-label"><LampDesk size={14} /> Tutor</span>
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
  </div>;
}

// Full state reads may have started before a lesson reply arrived. Keep every
// acknowledged lesson exchange when merging such a read into the current state.
function mergeLessonSessions(current: LessonSession[] = [], incoming: LessonSession[] = []) {
  return [...new Map([...current, ...incoming].map(session => [session.id, session])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function LessonConversation({ sessions, outgoing, draft, onDraft, onSend, onRetry }: {
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
  return <div className="conversation-panel lesson-conversation">
    <div className="conversation" ref={paneRef} role="log" aria-label="Lesson conversation" aria-live="polite" aria-relevant="additions text"
      onScroll={event => { const node = event.currentTarget; followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
      {entries.length ? entries.map(entry => <div className={'exchange ' + (entry.outgoing ? 'outgoing-exchange' : '')} key={entry.id}>
        <div className="chat-bubble user-bubble"><span className="bubble-label">You · {formatDate(entry.createdAt)}</span>
          <Markdown>{entry.session ? entry.session.requestText : entry.outgoing!.request.message}</Markdown>
        </div>
        {entry.session ? <TutorBubble response={entry.session.response} />
          : entry.outgoing?.status === 'sending' ? <div className="chat-bubble assistant-bubble tutor-waiting" role="status">
            <LampLoader /><span>ARI is thinking</span>
          </div> : entry.outgoing && <div className="message-error" role="alert"><p>{entry.outgoing.error}</p>
            <Button variant="ghost" onClick={() => onRetry(entry.outgoing!)}><RefreshCw size={14} /> Retry message</Button>
          </div>}
      </div>) : <div className="conversation-empty"><LampDesk size={20} /><p>Ask about this lesson.</p></div>}
    </div>
    <div className="composer">
      <Textarea value={draft} onChange={event => onDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend(); } }}
        aria-label="Question about this lesson" placeholder="What would you like to understand?" rows={2} maxLength={4000} />
      <div className="composer-actions"><span>Enter to send · Shift+Enter for a new line</span>
        <Button variant="primary" disabled={pending || !draft.trim()} onClick={onSend}>Send <Send size={16} /></Button>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(viewKey);
    return saved && Object.hasOwn(labels, saved) ? saved as View : 'desk';
  });
  const [state, setState] = useState<AppState | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const selectedIdRef = useRef('');
  const restoredExerciseRef = useRef(localStorage.getItem(selectedKey));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(sidebarKey) === 'true');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState(() => {
    const saved = localStorage.getItem(moduleKey);
    return saved || courseModules[0]?.id || '';
  });
  const learning = useLearning(view === 'chat', view !== 'desk');
  const [curriculumId, setCurriculumId] = useState(() => localStorage.getItem('ari:curriculum') || '');
  const [chatFocusId, setChatFocusId] = useState(() => localStorage.getItem('ari:chatFocus') || '');
  const [chatStarter, setChatStarter] = useState('');
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [pathTab, setPathTab] = useState<'lessons' | 'plan'>('lessons');
  const [draft, setDraft] = useState('');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [sendMode, setSendMode] = useState<TutorMode | null>(null);
  const sendBusyRef = useRef(false);
  const gradeCaptureRef = useRef<AbortController | null>(null);
  const uploadReadRef = useRef(0);
  const [preparingGrade, setPreparingGrade] = useState(false);
  const [sendError, setSendError] = useState('');
  const pageBusyRef = useRef(false);
  const [pageBusy, setPageBusy] = useState<'add' | string | null>(null);
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const [unsavedPages, setUnsavedPages] = useState<Record<string, UnsavedPage[]>>({});
  const [outgoingMessages, setOutgoingMessages] = useState<OutgoingMessage[]>([]);
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, string>>({});
  const [outgoingLessonMessages, setOutgoingLessonMessages] = useState<OutgoingLessonMessage[]>([]);
  const lessonBusyRef = useRef(new Map<string, string>());
  const [confidence, setConfidence] = useState(3);
  const [reflectionNotes, setReflectionNotes] = useState('');
  const [reflectionBusy, setReflectionBusy] = useState(false);
  const reflectionBusyRef = useRef(false);
  const [reflectionMessage, setReflectionMessage] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [generationDifficulty, setGenerationDifficulty] = useState<Difficulty>('stretch');
  const [generationBusy, setGenerationBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const [photoOpen, setPhotoOpen] = useState<string | null>(null);
  const photoOpenerRef = useRef<HTMLButtonElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeCameraRef = useRef<HTMLButtonElement>(null);
  const closePhotoRef = useRef<HTMLButtonElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const shouldFollowConversation = useRef(true);
  const camera = useCamera();

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [next, nextHealth, native] = await Promise.all([
        api<AppState>('/api/state', undefined, 30000),
        api<Health>('/api/health', undefined, 30000),
        api<{ available: boolean }>('/api/camera/status', undefined, 10000).catch(() => ({ available: false })),
      ]);
      const catalog = [...curated, ...next.generatedExercises];
      const saved = localStorage.getItem(selectedKey);
      const nextId = saved && catalog.some(item => item.id === saved)
        ? saved
        : diagnosticIds.find(id => next.progress[id]?.status !== 'completed')
          || catalog.find(item => next.progress[item.id]?.status !== 'completed')?.id
          || catalog[0]?.id || '';
      selectedIdRef.current = nextId;
      if (nextId) localStorage.setItem(selectedKey, nextId);
      setSelectedId(nextId);
      setState(current => ({ ...next, lessonSessions: mergeLessonSessions(current?.lessonSessions, next.lessonSessions) }));
      setHealth(nextHealth);
      setNativeAvailable(native.available);
      setProfileDraft(current => current || next.profile);
    } catch (error) {
      setLoadError(errorText(error));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { localStorage.setItem(sidebarKey, String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem(viewKey, view); }, [view]);
  useEffect(() => { localStorage.setItem(moduleKey, selectedModuleId); }, [selectedModuleId]);
  useEffect(() => { localStorage.setItem('ari:curriculum', curriculumId); }, [curriculumId]);
  useEffect(() => { localStorage.setItem('ari:chatFocus', chatFocusId); }, [chatFocusId]);
  const learningIdle = useRef(learning.idle);
  learningIdle.current = learning.idle;
  const boundaryRef = useRef({ view, selectedId });
  useEffect(() => {
    const previous = boundaryRef.current;
    if ((previous.view === 'desk' && (view !== 'desk' || previous.selectedId !== selectedId)) || (previous.view !== view && view === 'chat')) learningIdle.current();
    boundaryRef.current = { view, selectedId };
  }, [view, selectedId]);
  useEffect(() => {
    const acknowledged = new Set((state?.lessonSessions || []).map(session => session.id));
    if (!outgoingLessonMessages.some(item => acknowledged.has(item.id))) return;
    // A concurrent state refresh can acknowledge a reply even if its original
    // HTTP response was lost. Clear that pending exchange without sending twice.
    for (const session of state?.lessonSessions || []) {
      if (lessonBusyRef.current.get(session.moduleId) === session.id) lessonBusyRef.current.delete(session.moduleId);
    }
    setOutgoingLessonMessages(current => current.filter(item => !acknowledged.has(item.id)));
  }, [state?.lessonSessions, outgoingLessonMessages]);
  useEffect(() => {
    if (view !== 'desk') {
      gradeCaptureRef.current?.abort();
      camera.stop();
      setCameraExpanded(false);
    }
  }, [view, camera.stop]);
  useEffect(() => () => gradeCaptureRef.current?.abort(), []);
  useEffect(() => {
    if (!cameraExpanded || photoOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A camera-device menu owns its keyboard interaction while it is open.
      if (event.defaultPrevented || document.querySelector('[data-slot="select-content"][data-open]')) return;
      if (event.key === 'Escape') {
        if (cameraExpanded) { setCameraExpanded(false); expandButtonRef.current?.focus(); }
      }
      if (event.key === 'Tab') {
        const dialog = document.querySelector<HTMLElement>('[aria-modal="true"]');
        const focusable = dialog?.querySelectorAll<HTMLElement>('button, select, input, [href]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cameraExpanded, photoOpen]);
  useEffect(() => { if (cameraExpanded) closeCameraRef.current?.focus(); }, [cameraExpanded]);
  function openPhoto(id: string, opener: HTMLButtonElement) {
    photoOpenerRef.current = opener;
    setPhotoOpen(id);
  }

  const allModules = useMemo(() => [...new Map([...courseModules, ...(learning.data?.lessons || [])].map(item => [item.id, item])).values()], [learning.data?.lessons]);
  const catalog = useMemo(() => [...new Map([...curated, ...(state?.generatedExercises || []), ...(learning.data?.exercises || [])].map(item => [item.id, item])).values()], [state?.generatedExercises, learning.data?.exercises]);
  const activeCurriculum = learning.data?.curricula.find(item => item.id === curriculumId) || learning.data?.curricula.find(item => item.source === 'original');
  const pathModules = activeCurriculum ? allModules.filter(item => activeCurriculum.lessonIds.includes(item.id)) : courseModules;
  const exercise = catalog.find(item => item.id === selectedId);
  const currentModule = allModules.find(item => item.id === exercise?.moduleId);
  const selectedModule = pathModules.find(item => item.id === selectedModuleId) || pathModules[0];
  const selectedLesson = learning.data?.lessons.find(item => item.id === selectedModule?.id);
  useEffect(() => { if (learning.data && selectedModule && selectedModule.id !== selectedModuleId) setSelectedModuleId(selectedModule.id); }, [learning.data, selectedModule, selectedModuleId]);
  useEffect(() => {
    const saved = restoredExerciseRef.current;
    if (saved && learning.data?.exercises.some(item => item.id === saved)) { setSelectedId(saved); selectedIdRef.current = saved; localStorage.setItem(selectedKey, saved); restoredExerciseRef.current = null; }
  }, [learning.data?.exercises]);
  const lessonSessions = useMemo(() => (state?.lessonSessions || []).filter(item => item.moduleId === selectedModuleId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.lessonSessions, selectedModuleId]);
  const lessonOutgoing = useMemo(() => outgoingLessonMessages.filter(item => item.request.moduleId === selectedModuleId),
    [outgoingLessonMessages, selectedModuleId]);
  const progress = exercise ? state?.progress[exercise.id] : undefined;
  const pages = useMemo(() => (state?.exercisePages || []).filter(item => item.exerciseId === selectedId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.exercisePages, selectedId]);
  const pageError = pageErrors[selectedId] || '';
  const retryPages = unsavedPages[selectedId] || [];
  const sessions = useMemo(() => (state?.sessions || []).filter(item => item.exerciseId === selectedId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.sessions, selectedId]);
  const conversation = useMemo(() => {
    const entries: { id: string; createdAt: string; session?: Session; outgoing?: OutgoingMessage }[] = [
      ...sessions.map(session => ({ id: session.id, createdAt: session.createdAt, session })),
      ...outgoingMessages.filter(item => item.request.exerciseId === selectedId)
        .map(outgoing => ({ id: outgoing.id, createdAt: outgoing.createdAt, outgoing })),
    ];
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [sessions, outgoingMessages, selectedId]);
  const latestReview = state?.dailyReviews?.length
    ? [...state.dailyReviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : null;
  const exerciseCurriculum = learning.data?.curricula.find(item => item.lessonIds.includes(exercise?.moduleId || ''));
  const nextModules = exerciseCurriculum ? exerciseCurriculum.lessonIds.map(id => allModules.find(item => item.id === id)).filter((item): item is Module => !!item) : courseModules;
  const orderedIds = [...new Set([...(exerciseCurriculum?.source !== 'generated' ? diagnosticIds : []), ...nextModules.flatMap(item => item.exerciseIds), ...catalog.filter(item => nextModules.some(module => module.id === item.moduleId)).map(item => item.id)])];
  const nextId = orderedIds.slice(orderedIds.indexOf(selectedId) + 1).find(id => state?.progress[id]?.status !== 'completed');
  const nextExercise = catalog.find(item => item.id === nextId);
  const nextLesson = exerciseCurriculum?.source === 'generated'
    ? nextModules.slice(nextModules.findIndex(item => item.id === exercise?.moduleId) + 1).find(module => {
      const lesson = learning.data?.lessons.find(item => item.id === module.id);
      return lesson?.status !== 'ready' || module.exerciseIds.some(id => state?.progress[id]?.status !== 'completed');
    }) : undefined;

  function setPageErrorFor(exerciseId: string, message: string) {
    setPageErrors(current => ({ ...current, [exerciseId]: message }));
  }
  function pageAttachedToPendingMessage(pageId: string) {
    return outgoingMessages.some(item => (item.status === 'sending' || item.status === 'failed')
      && item.request.pageIds?.includes(pageId));
  }

  useEffect(() => {
    const pane = conversationRef.current;
    if (pane && shouldFollowConversation.current) pane.scrollTop = pane.scrollHeight;
  }, [conversation, selectedId, view]);
  useEffect(() => {
    setConfidence(progress?.confidence || 3);
    const reflection = [...(state?.reflections || [])].reverse().find(item => item.exerciseId === selectedId);
    setReflectionNotes(reflection?.notes || '');
    setReflectionMessage('');
  }, [selectedId]); // Deliberately do not reset notes when state refreshes.

  function selectExercise(id: string) {
    gradeCaptureRef.current?.abort();
    restoredExerciseRef.current = null;
    uploadReadRef.current++;
    selectedIdRef.current = id;
    setSelectedId(id);
    localStorage.setItem(selectedKey, id);
    setView('desk');
    setMobileMenu(false);
    setDraft('');
    setUploadedImage(null);
    setUploadName('');
    setSendError('');
    setActionError('');
    setCameraExpanded(false);
    shouldFollowConversation.current = true;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showLesson(moduleId: string) {
    gradeCaptureRef.current?.abort();
    uploadReadRef.current++;
    const owner = learning.data?.curricula.find(item => item.lessonIds.includes(moduleId));
    if (owner) setCurriculumId(owner.id);
    setSelectedModuleId(moduleId);
    setPathTab('lessons');
    setView('path');
  }
  function openCurriculum(id: string) {
    setCurriculumId(id); setSelectedModuleId(learning.data?.curricula.find(item => item.id === id)?.lessonIds[0] || ''); setPathTab('lessons'); setView('path');
  }
  async function prepareLesson() {
    if (!selectedModule || prepareBusy) return; setPrepareBusy(true); setActionError('');
    try { await learningApi('/lessons/' + encodeURIComponent(selectedModule.id) + '/prepare', {}); await learning.refresh(); }
    catch (failure) { setActionError(learningError(failure)); } finally { setPrepareBusy(false); }
  }
  async function refreshState() {
    // These replies were already acknowledged before this read began.
    const savedIds = new Set(outgoingMessages.filter(item => item.status === 'saved').map(item => item.id));
    const next = await api<AppState>('/api/state', undefined, 30000);
    setState(current => ({ ...next, lessonSessions: mergeLessonSessions(current?.lessonSessions, next.lessonSessions) }));
    setOutgoingMessages(current => current.filter(item => !savedIds.has(item.id)));
    return next;
  }
  async function deliverLessonMessage(outgoing: OutgoingLessonMessage) {
    const moduleId = outgoing.request.moduleId;
    if (lessonBusyRef.current.has(moduleId)) return;
    lessonBusyRef.current.set(moduleId, outgoing.id);
    setOutgoingLessonMessages(current => current.map(item => item.id === outgoing.id
      ? { ...item, status: 'sending', error: undefined } : item));
    try {
      const session = await post<LessonSession>('/api/lesson-chat', outgoing.request);
      setState(current => current ? { ...current,
        lessonSessions: mergeLessonSessions(current.lessonSessions, [session]),
      } : current);
      setOutgoingLessonMessages(current => current.filter(item => item.id !== outgoing.id));
    } catch (error) {
      setOutgoingLessonMessages(current => current.map(item => item.id === outgoing.id
        ? { ...item, status: 'failed', error: errorText(error) } : item));
    } finally {
      if (lessonBusyRef.current.get(moduleId) === outgoing.id) lessonBusyRef.current.delete(moduleId);
    }
  }
  function sendLessonMessage() {
    if (!selectedModule || lessonBusyRef.current.has(selectedModule.id) || lessonOutgoing.length) return;
    const message = (lessonDrafts[selectedModule.id] || '').trim();
    if (!message) return;
    const id = crypto.randomUUID();
    const outgoing: OutgoingLessonMessage = {
      id, createdAt: new Date().toISOString(), status: 'sending',
      request: { id, moduleId: selectedModule.id, message, language: state?.profile.language || 'en' },
    };
    setOutgoingLessonMessages(current => [...current, outgoing]);
    setLessonDrafts(current => ({ ...current, [selectedModule.id]: '' }));
    void deliverLessonMessage(outgoing);
  }
  async function addPage(retryId?: string) {
    if (!exercise || pageBusyRef.current || sendBusyRef.current || reflectionBusyRef.current) return;
    const exerciseId = exercise.id;
    if (pages.length >= MAX_EXERCISE_PAGES) {
      setPageErrorFor(exerciseId, `This exercise has ${MAX_EXERCISE_PAGES} saved pages. Remove one before adding another.`);
      return;
    }
    const savedCapture = retryId ? retryPages.find(item => item.id === retryId) : undefined;
    if (retryId && !savedCapture) return;
    pageBusyRef.current = true;
    setPageBusy('add');
    setPageErrorFor(exerciseId, '');
    let image = savedCapture?.image || uploadedImage;
    let controller: AbortController | null = null;
    try {
      if (!image) {
        controller = new AbortController();
        gradeCaptureRef.current = controller;
        image = await camera.captureWhenReady(nativeAvailable, controller.signal);
        if (controller.signal.aborted || selectedIdRef.current !== exerciseId) return;
        if (gradeCaptureRef.current === controller) gradeCaptureRef.current = null;
        controller = null;
      }
      const page = await post<ExercisePage>('/api/exercises/' + encodeURIComponent(exerciseId) + '/pages', { image });
      setState(current => current ? { ...current, exercisePages: [...(current.exercisePages || []), page] } : current);
      if (retryId) setUnsavedPages(current => ({ ...current,
        [exerciseId]: (current[exerciseId] || []).filter(item => item.id !== retryId),
      }));
    } catch (error) {
      if (!controller?.signal.aborted && image) {
        const failedImage = image;
        const failure = errorText(error);
        setUnsavedPages(current => ({ ...current, [exerciseId]: retryId
          ? (current[exerciseId] || []).map(item => item.id === retryId ? { ...item, error: failure } : item)
          : [...(current[exerciseId] || []), { id: crypto.randomUUID(), image: failedImage, error: failure }],
        }));
      } else if (!controller?.signal.aborted && selectedIdRef.current === exerciseId) {
        setPageErrorFor(exerciseId, errorText(error));
      }
    } finally {
      if (gradeCaptureRef.current === controller) gradeCaptureRef.current = null;
      pageBusyRef.current = false;
      setPageBusy(null);
    }
  }
  async function removePage(page: ExercisePage) {
    if (pageBusyRef.current || sendBusyRef.current || reflectionBusyRef.current || pageAttachedToPendingMessage(page.id)) return;
    pageBusyRef.current = true;
    setPageBusy(page.id);
    setPageErrorFor(page.exerciseId, '');
    try {
      await api<void>('/api/exercises/' + encodeURIComponent(page.exerciseId) + '/pages/' + encodeURIComponent(page.id), { method: 'DELETE' });
      setState(current => current ? { ...current,
        exercisePages: (current.exercisePages || []).filter(item => item.id !== page.id),
      } : current);
    } catch (error) {
      setPageErrorFor(page.exerciseId, 'Could not remove this page: ' + errorText(error));
    } finally {
      pageBusyRef.current = false;
      setPageBusy(null);
    }
  }
  async function send(mode: TutorMode) {
    if (!exercise || sendBusyRef.current || pageBusyRef.current || reflectionBusyRef.current) return;
    const exerciseId = exercise.id;
    const submittedPages = pages;
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    let image = uploadedImage || (camera.active ? camera.capture() : null);
    if (mode === 'check' && !image) {
      const controller = new AbortController();
      gradeCaptureRef.current = controller;
      sendBusyRef.current = true;
      setSendMode('check');
      setPreparingGrade(true);
      setSendError('');
      try {
        image = await camera.captureWhenReady(nativeAvailable, controller.signal);
        if (controller.signal.aborted || selectedIdRef.current !== exerciseId) return;
      } catch (error) {
        if (!controller.signal.aborted && selectedIdRef.current === exerciseId)
          setSendError(errorText(error));
        return;
      } finally {
        if (gradeCaptureRef.current === controller) gradeCaptureRef.current = null;
        sendBusyRef.current = false;
        setSendMode(null);
        setPreparingGrade(false);
      }
    }
    if (camera.active && !uploadedImage && !image) {
      setSendError('The live frame is not ready yet. Wait until the paper appears, then try again.');
      return;
    }
    if (mode === 'chat' && !text && !image && !submittedPages.length) {
      setSendError('Type a question, show your paper, or upload a photo before sending.');
      return;
    }
    setSendError('');
    const outgoing: OutgoingMessage = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'sending',
      pageSnapshotIds: submittedPages.map(page => page.snapshotId),
      request: { exerciseId, mode, language: state?.profile.language || 'en',
        ...(submittedPages.length ? { pageIds: submittedPages.map(page => page.id) } : {}),
        ...(image ? { image } : {}), ...(text ? { message: text } : {}) },
    };
    shouldFollowConversation.current = true;
    setOutgoingMessages(current => [...current, outgoing]);
    setDraft(current => current === submittedDraft ? '' : current);
    composerRef.current?.focus();
    await deliverMessage(outgoing);
  }
  async function deliverMessage(outgoing: OutgoingMessage) {
    if (sendBusyRef.current || pageBusyRef.current) return;
    sendBusyRef.current = true;
    setSendMode(outgoing.request.mode === 'check' ? 'check' : 'chat');
    setOutgoingMessages(current => current.map(item => item.id === outgoing.id
      ? { ...item, status: 'sending', error: undefined } : item));
    let saved = false;
    let response: TutorResponse | undefined;
    try {
      response = await post<TutorResponse>('/api/tutor', outgoing.request);
      saved = true;
      await refreshState();
      setOutgoingMessages(current => current.filter(item => item.id !== outgoing.id));
    } catch (error) {
      setOutgoingMessages(current => current.map(item => item.id === outgoing.id ? {
        ...item, status: saved ? 'saved' : 'failed', response,
        error: saved ? 'Your reply was saved. Refresh the conversation to sync it.' : errorText(error),
      } : item));
    } finally {
      sendBusyRef.current = false;
      setSendMode(null);
    }
  }
  async function syncMessage(outgoing: OutgoingMessage) {
    if (sendBusyRef.current) return;
    sendBusyRef.current = true;
    setSendMode('chat');
    try {
      await refreshState();
      setOutgoingMessages(current => current.filter(item => item.id !== outgoing.id));
    } catch {
      setOutgoingMessages(current => current.map(item => item.id === outgoing.id
        ? { ...item, error: 'Still unable to refresh. Your reply is saved; try again in a moment.' } : item));
    } finally {
      sendBusyRef.current = false;
      setSendMode(null);
    }
  }
  function onUpload(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setActionError('Choose a JPEG, PNG, or WebP photo.'); return;
    }
    if (file.size > 5_000_000) { setActionError('Choose a photo under 5 MB.'); return; }
    gradeCaptureRef.current?.abort();
    const readId = ++uploadReadRef.current;
    const exerciseId = selectedIdRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (readId !== uploadReadRef.current || selectedIdRef.current !== exerciseId) return;
      camera.stop();
      setUploadedImage(String(reader.result));
      setUploadName(file.name);
      setActionError('');
    };
    reader.onerror = () => setActionError('Could not read that photo. Try another file.');
    reader.readAsDataURL(file);
  }
  async function runDailyReview() {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewStatus('Reflecting on today…');
    try {
      const review = await post<DailyReview>('/api/reviews/daily', {
        date: localDay(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setState(current => current ? {
        ...current, dailyReviews: [...current.dailyReviews.filter(item =>
          item.date !== review.date || item.timeZone !== review.timeZone), review],
      } : current);
      setReviewStatus('Today’s tutor review is saved in your journal.');
    } catch (error) {
      setReviewStatus('Daily review could not be saved: ' + errorText(error) + ' Retry from the journal.');
    } finally {
      setReviewBusy(false);
    }
  }
  async function saveReflection() {
    if (!exercise || reflectionBusyRef.current || pageBusyRef.current || sendBusyRef.current) return;
    reflectionBusyRef.current = true;
    setReflectionBusy(true);
    setReflectionMessage('');
    const exerciseId = exercise.id;
    try {
      const image = uploadedImage || (camera.active ? camera.capture() : null);
      if (camera.active && !uploadedImage && !image) {
        setReflectionMessage('The live frame is not ready yet. Wait until the paper appears, then save again.');
        return;
      }
      const result = await post<ReflectionResponse>('/api/reflections', {
        exerciseId, confidence, notes: reflectionNotes.trim(),
        ...(pages.length ? { pageIds: pages.map(page => page.id) } : {}),
        ...(image ? { image } : {}),
      });
      setState(current => current ? {
        ...current,
        progress: { ...current.progress, [exerciseId]: result.progress },
        reflections: [...current.reflections, result.reflection],
      } : current);
      if (selectedIdRef.current === exerciseId) setReflectionMessage('Reflection saved. This exercise is complete.');
      void runDailyReview();
      learning.idle();
    } catch (error) {
      if (selectedIdRef.current === exerciseId) setReflectionMessage('Could not save reflection: ' + errorText(error));
    } finally { reflectionBusyRef.current = false; setReflectionBusy(false); }
  }
  async function generateExercise(moduleId: string, difficulty: Difficulty) {
    if (generationBusy) return;
    setGenerationBusy(true);
    setActionError('');
    try {
      const next = await post<Exercise>('/api/exercises/generate', { moduleId, difficulty });
      setState(current => current ? { ...current, generatedExercises: [...current.generatedExercises, next] } : current);
      selectExercise(next.id);
    } catch (error) { setActionError(errorText(error)); }
    finally { setGenerationBusy(false); }
  }
  async function generatePlan() {
    if (planBusy) return;
    setPathTab('plan');
    setPlanBusy(true);
    setActionError('');
    try {
      const plan = await post<StudyPlan>('/api/plan', {});
      setState(current => current ? { ...current, plan } : current);
      setPathTab('plan');
    } catch (error) { setActionError(errorText(error)); }
    finally { setPlanBusy(false); }
  }
  async function saveProfile() {
    if (!profileDraft || profileBusy) return;
    setProfileBusy(true);
    setProfileMessage('');
    try {
      const profile = await post<Profile>('/api/profile', profileDraft, 'PATCH');
      setState(current => current ? { ...current, profile } : current);
      setProfileDraft(profile);
      setProfileMessage('Preferences saved.');
    } catch (error) { setProfileMessage('Could not save preferences: ' + errorText(error)); }
    finally { setProfileBusy(false); }
  }
  async function exportJournal() {
    setActionError('');
    try {
      const response = await fetch('/api/export');
      if (!response.ok) throw new Error('Export failed (' + response.status + ').');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ari-' + localDay() + '.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setActionError(errorText(error)); }
  }

  if (loadError && !state) return <div className="loading-screen">
    <h1>Could not open your desk.</h1><p>{loadError}</p>
    <Button variant="primary" onClick={() => void load()}>Try again <ArrowRight size={16} /></Button>
  </div>;
  if (!state) return <div className="loading-screen" role="status"><LampLoader size={80} /><h1>Preparing your desk…</h1></div>;

  const completedCount = Object.values(state.progress).filter(item => item.status === 'completed').length;

  return <div className={'app-shell ' + (sidebarCollapsed ? 'sidebar-collapsed' : '')}>
    <aside className={'sidebar ' + (mobileMenu ? 'sidebar-open' : '')}>
      <div className="brand"><span className="brand-mark" aria-hidden="true"><LampLoader size={42} /></span><strong>A<span className="brand-middle">R</span>I</strong></div>
      <Button variant="plain" className="collapse-button" onClick={() => setSidebarCollapsed(value => !value)}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Menu size={19} /></Button>
      <nav className="main-nav" aria-label="Main navigation">
        {(['desk', 'chat', 'path', 'journal', 'settings'] as View[]).map(item =>
          <Button variant="plain" key={item} title={labels[item]} aria-label={labels[item]}
            className={'nav-item ' + (view === item ? 'active' : '')}
            onClick={() => { if (item !== 'desk') gradeCaptureRef.current?.abort(); setView(item); setMobileMenu(false); setActionError(''); }}>
            {navIcon(item)}<span>{labels[item]}</span>{(item === 'chat' || item === 'path') && !!learning.data?.unreadCount && <i className="unread-dot" aria-label="Unread message" />}
          </Button>,
        )}
      </nav>
      <div className="sidebar-foot">
        <span className="learner-name">{state.profile.name || 'Learner'}</span>
        <span className="completion-count"><CheckCircle2 size={13} aria-hidden="true" />
          <span><strong>{completedCount}</strong> {completedCount === 1 ? 'exercise' : 'exercises'} completed</span>
        </span>
      </div>
    </aside>
    {mobileMenu && <Button variant="plain" className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
    <main className="main-area">
      <Button variant="plain" className="mobile-menu" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={22} /></Button>
      {view === 'desk' && exercise && <section className="page desk-page">
        <div className="desk-heading"><div><h1>{exercise.title}</h1></div>
          <span className={'tutor-status ' + (health?.aiConfigured ? 'ready' : '')}>{health?.aiConfigured ? 'Tutor ready' : 'Tutor unavailable'}</span>
        </div>
        <div className="desk-grid">
          <div className="exercise-column">
            <article className="exercise-sheet">
              <div className="exercise-meta"><span>{diagnosticIds.includes(exercise.id) ? 'DIAGNOSTIC · ' : ''}{exercise.difficulty.toUpperCase()}</span><span>{exercise.minutes} MIN</span></div>
              <Button variant="plain" className="lesson-link" onClick={() => currentModule && showLesson(currentModule.id)}>
                <BookOpen size={16} /> Lesson: {currentModule?.title || 'Practice'} / short lesson <ArrowRight size={15} />
              </Button>
              <div className="exercise-body"><Markdown>{exercise.prompt}</Markdown></div>
            </article>
            <div className="conversation-panel">
              <div className="conversation" ref={conversationRef} role="log" aria-label="Exercise conversation" aria-live="polite" aria-relevant="additions text"
                onScroll={event => { const node = event.currentTarget; shouldFollowConversation.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
                {conversation.length ? conversation.map(({ id, createdAt, session, outgoing }) => session ? <div className="exchange" key={id}>
                  <div className="chat-bubble user-bubble"><span className="bubble-label">You · {formatDate(session.createdAt)}</span>
                    <p>{session.requestText || (photoIds(session).length ? 'Photo of my work' : session.mode === 'check' ? 'Grade my work' : 'Question')}</p>
                    <PhotoSet ids={photoIds(session)} label="Submitted work" onOpen={openPhoto} />
                  </div>
                  <TutorBubble response={session.response} />
                </div> : outgoing && <div className="exchange outgoing-exchange" key={id}>
                  <div className="chat-bubble user-bubble"><span className="bubble-label">You · {formatDate(createdAt)}</span>
                    <p>{outgoing.request.message || (outgoing.pageSnapshotIds.length || outgoing.request.image ? 'Photo of my work' : 'Grade my work')}</p>
                    <PhotoSet ids={[...outgoing.pageSnapshotIds, ...(outgoing.request.image ? [outgoing.request.image] : [])]}
                      label="Submitted work" onOpen={openPhoto} />
                  </div>
                  {outgoing.status === 'sending' && <div className="chat-bubble assistant-bubble tutor-waiting" role="status">
                    <LampLoader /><span>ARI is thinking</span>
                  </div>}
                  {outgoing.response && <TutorBubble response={outgoing.response} />}
                  {outgoing.error && <div className="message-error" role="alert"><p>{outgoing.error}</p>
                    <Button variant="ghost" disabled={!!sendMode || !!pageBusy} onClick={() => void (outgoing.status === 'saved'
                      ? syncMessage(outgoing) : deliverMessage(outgoing))}>
                      <RefreshCw size={14} /> {outgoing.status === 'saved' ? 'Refresh conversation' : 'Retry message'}
                    </Button>
                  </div>}
                </div>) : <div className="conversation-empty"><LampDesk size={20} />
                  <p>Ask a question or share your paper.</p>
                </div>}
              </div>
              <div className="composer">
                {(pages.length > 0 || camera.active || uploadedImage) && <p className="composer-attachment"><Camera size={14} aria-hidden="true" />
                  {pages.length ? `${pages.length} saved ${pages.length === 1 ? 'page' : 'pages'}${camera.active || uploadedImage ? ' + current view' : ' · Grade my work will capture the current view'}.`
                    : uploadedImage ? 'This photo is included with every message.' : 'A fresh photo of your paper is included with every message.'}
                </p>}
                <Textarea ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send('chat'); } }}
                  aria-label="Message to tutor" placeholder="Ask a question or describe your reasoning…"
                  rows={3} maxLength={4000} />
                <div className="composer-actions"><span>Enter to send · Shift+Enter for a new line</span>
                  <Button variant="secondary" disabled={!!sendMode || !!pageBusy || reflectionBusy} onClick={() => void send('check')}>
                    {preparingGrade ? 'Connecting camera…' : 'Grade my work'}</Button>
                  <Button variant="primary" disabled={!!sendMode || !!pageBusy || reflectionBusy} onClick={() => void send('chat')}>
                    Send <Send size={16} /></Button>
                </div>
                {preparingGrade && <p className="status-line loading-status" role="status"><LampLoader size={28} />Connecting to your camera and waiting for your paper…</p>}
                {sendError && <p className="inline-error" role="alert">{sendError}</p>}
              </div>
            </div>
          </div>
          <div className="work-column">
            <div className="camera-panel">
              <div className="panel-heading"><div><span className="eyebrow">YOUR PAPER</span><h2>Live view</h2></div>
                <Button variant="icon" ref={expandButtonRef} title="Expand paper view"
                  aria-label="Expand paper view" onClick={() => setCameraExpanded(true)}><Expand size={19} /></Button>
              </div>
              <div className={'camera-stage ' + (camera.rotation % 180 ? 'portrait ' : '') + (cameraExpanded ? 'expanded' : '')}
                role={cameraExpanded ? 'dialog' : undefined} aria-modal={cameraExpanded ? 'true' : undefined}
                aria-label={cameraExpanded ? 'Expanded paper view' : undefined}>
                {cameraExpanded && <div className="expanded-toolbar"><strong>Paper view</strong>
                  <Button variant="icon" ref={closeCameraRef} aria-label="Close expanded view"
                    onClick={() => { setCameraExpanded(false); expandButtonRef.current?.focus(); }}><Minimize size={19} /></Button>
                </div>}
                <div className="camera-image-area">
                  {uploadedImage ? <img src={uploadedImage} alt="Uploaded work" className="uploaded-preview" />
                    : camera.active ? <div className={'video-frame ' + (camera.rotation % 180 ? 'sideways' : '')}>
                      {camera.mode === 'native'
                        ? camera.nativeFrameUrl
                          ? <img ref={camera.nativeImageRef} src={camera.nativeFrameUrl} alt="Live IPEVO paper preview"
                            style={{ transform: 'translate(-50%, -50%) rotate(' + camera.rotation + 'deg) scaleX(' + (camera.mirrored ? -1 : 1) + ')' }} />
                          : <span className="loading-status"><LampLoader size={32} />Connecting to IPEVO…</span>
                        : <video ref={camera.videoRef} autoPlay muted playsInline
                          style={{ transform: 'translate(-50%, -50%) rotate(' + camera.rotation + 'deg) scaleX(' + (camera.mirrored ? -1 : 1) + ')' }} />}
                    </div> : <div className="camera-placeholder"><Camera size={31} /><strong>Bring your notebook into view</strong>
                      <p>Start a camera or upload a photo to share your work.</p>
                      <div>{nativeAvailable && <Button variant="secondary" loading={camera.starting} disabled={camera.starting}
                        onClick={() => void camera.startNative()}>{camera.starting ? 'Connecting…' : 'Use IPEVO on this Mac'}</Button>}
                        <Button variant="secondary" disabled={camera.starting} onClick={() => void camera.start()}>
                          Use browser camera</Button></div>
                    </div>}
                </div>
                {camera.active && !uploadedImage && <span className="live-label">{camera.deviceLabel} · local preview</span>}
                {cameraExpanded && <p className="focus-tip">Adjust focus and exposure on the physical camera. Move the camera or paper to change the field of view.</p>}
                {camera.active && !uploadedImage && <div className="camera-controls">
                  {camera.active && camera.mode === 'browser' && <Select compact aria-label="Camera device" value={camera.deviceId}
                    onValueChange={value => void camera.start(value)}
                    options={camera.devices.map(device => ({ value: device.deviceId, label: device.label || 'Camera' }))} />}
                  <div>
                    <Button variant="icon" title="Rotate preview and snapshot" aria-label="Rotate camera"
                      onClick={() => camera.setRotation(value => (value + 90) % 360)}><RotateCw size={18} /></Button>
                    <Button variant="icon" title="Mirror preview and snapshot" aria-label="Mirror camera"
                      onClick={() => camera.setMirrored(value => !value)}><RefreshCw size={18} /></Button>
                    {camera.active && <Button variant="icon" title="Stop camera" aria-label="Stop camera"
                      onClick={() => camera.stop()}><Pause size={18} /></Button>}
                  </div>
                </div>}
              </div>
              {camera.error && camera.error !== sendError && <p className="inline-error" role="alert">{camera.error}</p>}
              <div className="upload-row">
                <FileUpload label="Upload photo" accept="image/jpeg,image/png,image/webp" onFile={onUpload}>
                  <Upload size={15} /> Upload photo
                </FileUpload>
                <Button variant="ghost" loading={pageBusy === 'add'} disabled={!!pageBusy || !!sendMode || reflectionBusy}
                  onClick={() => void addPage()}><Plus size={15} /> {pageBusy === 'add' ? 'Saving page…' : 'Add page'}</Button>
              </div>
              {uploadedImage && <div className="upload-selected"><span>{uploadName}</span>
                <Button variant="icon" aria-label="Remove uploaded photo"
                  onClick={() => { setUploadedImage(null); setUploadName(''); }}><X size={15} /></Button>
              </div>}
              {(pages.length > 0 || retryPages.length > 0 || pageError) && <div className="saved-pages">
                {pages.length > 0 && <div className="saved-pages-list" aria-label="Saved pages">
                  {pages.map((page, index) => {
                    const locked = pageAttachedToPendingMessage(page.id);
                    return <div className="saved-page" key={page.id}>
                    <Button variant="plain" className="saved-page-photo" onClick={event => openPhoto(page.snapshotId, event.currentTarget)}
                      aria-label={`Expand saved page ${index + 1}`}>
                      <img src={photoSource(page.snapshotId)} alt={`Saved page ${index + 1}`} loading="lazy" />
                      <span>{index + 1}</span>
                    </Button>
                    <span className="saved-page-remove-wrap" title={locked ? 'Attached to a message waiting to be sent' : undefined}>
                      <Button variant="plain" className="saved-page-remove" aria-label={`Remove saved page ${index + 1}${locked ? ', attached to a message waiting to be sent' : ''}`}
                        title={locked ? undefined : `Remove page ${index + 1}`}
                        disabled={!!pageBusy || !!sendMode || reflectionBusy || locked}
                        onClick={() => void removePage(page)}><X size={13} /></Button>
                    </span>
                  </div>})}
                </div>}
                {retryPages.map(item => <div className="page-retry" key={item.id}>
                  <Snapshot id={item.image} label="Unsaved page" onOpen={openPhoto} />
                  <div><p className="page-retry-error" role="alert">Could not save this page: {item.error}</p>
                  <Button variant="ghost" disabled={!!pageBusy || !!sendMode || reflectionBusy}
                    onClick={() => void addPage(item.id)}><RefreshCw size={14} /> Retry saving this photo</Button></div>
                </div>)}
                {pageError && <p className="inline-error" role="alert">{pageError}</p>}
              </div>}
            </div>
            <div className="reflection-card">
              <span className="eyebrow">AFTER YOUR WORK</span>
              <h2>Reflect and mark complete</h2>
              <div className="confidence-field"><span>Confidence <strong>{confidence}/5</strong></span>
                <Slider label="Confidence" min={1} max={5} step={1} value={confidence} onValueChange={setConfidence}
                  valueText={value => `${value} out of 5`} />
              </div>
              <label>What clicked, or what remains unclear? <span>(optional)</span>
                <Textarea value={reflectionNotes} onChange={event => setReflectionNotes(event.target.value)} rows={3} maxLength={4000} />
              </label>
              <Button variant="primary" loading={reflectionBusy} disabled={reflectionBusy || !!pageBusy || !!sendMode} onClick={() => void saveReflection()}>
                <Check size={16} /> {reflectionBusy ? 'Saving…' : progress?.status === 'completed' ? 'Save another reflection' : 'Mark complete and save'}
              </Button>
              {reflectionMessage && <p className="status-line" role="status">{reflectionMessage}</p>}
              {reviewStatus && <p className="status-line loading-status" role="status">{reviewBusy && <LampLoader size={28} />}{reviewStatus}</p>}
            </div>
            <div className="next-actions">
              <span className="eyebrow">NEXT STEP</span>
              <p>{progress?.status === 'completed' ? 'Ready for another challenge?' : 'Work through this on paper. Send a question or ask for a grade when ready.'}</p>
              <div>
                {nextExercise && <Button variant="secondary" onClick={() => selectExercise(nextExercise.id)}>Next exercise: {nextExercise.title} <ArrowRight size={16} /></Button>}
                {!nextExercise && nextLesson && <Button variant="secondary" onClick={() => showLesson(nextLesson.id)}>Next lesson: {nextLesson.title} <ArrowRight size={16} /></Button>}
                {currentModule && <Button variant="ghost" loading={generationBusy} disabled={generationBusy}
                  onClick={() => void generateExercise(currentModule.id, 'stretch')}>
                  {generationBusy ? 'Generating…' : 'Try a harder exercise'} <LampDesk size={15} />
                </Button>}
              </div>
            </div>
          </div>
        </div>
        {actionError && <p className="page-error" role="alert">{actionError}</p>}
      </section>}
      {view === 'chat' && <section className="page main-chat-page">{learning.data ? <MainConversation data={learning.data} pending={learning.pending} deliver={learning.deliver} refresh={learning.refresh} focusId={chatFocusId} setFocusId={setChatFocusId} openCurriculum={openCurriculum} starter={chatStarter} clearStarter={() => setChatStarter('')} /> : <div className="loading-screen" role={learning.error ? undefined : 'status'}>{learning.error ? <LampDesk size={30} /> : <LampLoader size={72} />}<h2>{learning.error ? 'Could not open your conversation' : 'Opening your conversation…'}</h2>{learning.error && <><p>{learning.error}</p><Button variant="secondary" onClick={() => void learning.refresh()}>Try again</Button></>}</div>}{learning.data && learning.error && <p className="inline-error" role="alert">{learning.error}<Button variant="ghost" onClick={() => void learning.refresh()}>Reconnect</Button></p>}</section>}
      {view === 'path' && <section className="page">
        <div className="page-heading"><h1>Learning path</h1>
          <p>Choose a lesson, or explore what you want to learn next.</p></div>
        <Button variant="plain" className="learning-chat-entry" onClick={() => { setChatFocusId(activeCurriculum?.id || ''); setView('chat'); }}><span className="learning-entry-lamp"><LampDesk size={25} strokeWidth={1.5} /></span><span><strong>Talk with ARI</strong><small>Ask a question or shape your next learning path.</small></span>{!!learning.data?.unreadCount && <i className="unread-dot" aria-label="Unread message" />}<ArrowRight size={18} /></Button>
        {learning.data && <div className="curriculum-selector"><label htmlFor="curriculum-select">Your curricula</label><Select id="curriculum-select" value={activeCurriculum?.id || ''} onValueChange={openCurriculum} options={learning.data.curricula.map(item => ({ value: item.id, label: item.title }))} /><Button variant="ghost" onClick={() => { setChatFocusId(''); setChatStarter('I’d like to learn a new subject. '); setView('chat'); }}><Plus size={14} />Explore a new subject</Button></div>}
        <div className="tab-row"><Button variant="plain" className={pathTab === 'lessons' ? 'selected' : ''} onClick={() => setPathTab('lessons')}>All lessons</Button>
          {(!activeCurriculum || activeCurriculum.source === 'original') && <Button variant="plain" className={pathTab === 'plan' ? 'selected' : ''} onClick={() => setPathTab('plan')}>Your plan</Button>}</div>
        {pathTab === 'lessons' ? <div className="path-layout">
          <div className="module-list">{pathModules.map((module, index) => {
            const lessonExercises = catalog.filter(item => item.moduleId === module.id);
            const lesson = learning.data?.lessons.find(item => item.id === module.id);
            const complete = (!lesson || lesson.status === 'ready')
              && lessonExercises.filter(item => state.progress[item.id]?.status === 'completed').length >= 2;
            return <Button variant="plain" key={module.id}
            className={'module-row ' + (selectedModule?.id === module.id ? 'selected' : '')}
            onClick={() => setSelectedModuleId(module.id)}>
            <span className={'subject-mark ' + module.subject}>{module.subject === 'math' ? 'M' : module.subject === 'physics' ? 'P' : <BookOpen size={14} />}</span>
            <span className="module-row-copy"><strong>{module.title}</strong><span className="module-row-meta">
              <small>{activeCurriculum?.source === 'generated' ? `Lesson ${index + 1} · ${lesson?.status || 'planned'}` : `Phase ${module.phase} · ${module.subject}`}</small>
              {complete && <span className="module-complete"><Check size={11} aria-hidden="true" />Complete</span>}
            </span></span>
          </Button>; })}</div>
          {selectedModule && <article className="module-detail"><span className="eyebrow">{activeCurriculum?.source === 'generated' ? `${activeCurriculum.topic} · ${selectedLesson?.status || 'planned'}` : `SHORT LESSON · PHASE ${selectedModule.phase}`}</span>
            <h2>{selectedModule.title}</h2><em>{selectedModule.frenchTitle}</em><p>{selectedModule.summary}</p>
            {selectedLesson && selectedLesson.status !== 'ready' ? <div className="lesson-preparation">{prepareBusy || selectedLesson.status === 'preparing' ? <LampLoader size={48} /> : <LampDesk size={24} />}<h3>{selectedLesson.status === 'preparing' ? 'ARI is preparing this lesson' : selectedLesson.status === 'failed' ? 'This lesson needs another try' : 'Ready when you are'}</h3><p>{selectedLesson.status === 'preparing' ? 'Its explanation and exercises will appear here. You can leave this page while ARI works.' : 'ARI will prepare this lesson and tailored exercises from your learning path and recent work.'}</p>{selectedLesson.error && <p className="inline-error">{selectedLesson.error}</p>}<Button variant="primary" disabled={prepareBusy || selectedLesson.status === 'preparing'} onClick={() => void prepareLesson()}>{prepareBusy || selectedLesson.status === 'preparing' ? 'Preparing…' : selectedLesson.status === 'failed' ? 'Retry preparation' : 'Prepare lesson'}<ArrowRight size={15} /></Button></div> : <Markdown>{selectedModule.primer}</Markdown>}
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
          </article>}
        </div> : <div className="plan-view"><div className="plan-intro"><span className="eyebrow">PROPOSED ORDER AND SCHEDULE</span>
          <h2>{state.plan?.title || 'A plan for your current pace'}</h2>
          <p>{state.plan?.summary || 'Build a route from your goals, completed exercises, reflections, and recent tutor review.'}</p>
          {latestReview && <p><strong>Latest review suggests:</strong> {latestReview.nextSteps[0] || latestReview.summary}</p>}
          <Button variant="primary" loading={planBusy} disabled={planBusy} onClick={() => void generatePlan()}>
            {planBusy ? 'Building…' : latestReview ? 'Update plan from this review' : state.plan ? 'Refresh plan' : 'Build my plan'}
          </Button>
          {state.plan?.adjustment && <p><strong>Why this plan?</strong> {state.plan.adjustment}</p>}
        </div><div className="weeks">{state.plan?.weeks.map(week => <div className="week-block" key={week.week}>
          <span className="eyebrow">WEEK {week.week}</span><h3>{week.focus}</h3>
          {week.sessions.map((session, index) => <Button variant="plain" key={session.exerciseId + index} onClick={() => selectExercise(session.exerciseId)}>
            <strong>{session.title}</strong><span>{session.minutes} min</span><ArrowRight size={16} /></Button>)}
        </div>)}</div></div>}
        {actionError && <p className="page-error" role="alert">{actionError}</p>}
      </section>}
      {view === 'journal' && <section className="page">
        <div className="page-heading journal-heading"><div><h1>Journal</h1>
          <p>Conversations, submitted photos, reflections, and the tutor’s daily review.</p></div>
          <Button variant="secondary" onClick={() => void exportJournal()}><Download size={16} /> Export data</Button></div>
        <div className="journal-grid">
          <div className="journal-card review-card"><div className="card-heading"><h2>Daily tutor review</h2>
            <Button variant="ghost" loading={reviewBusy} disabled={reviewBusy} onClick={() => void runDailyReview()}>
              {reviewBusy ? 'Reflecting…' : 'Reflect on today'} <LampDesk size={15} /></Button></div>
            {latestReview ? <div><small>{formatDate(latestReview.createdAt)}</small><p>{latestReview.summary}</p>
              <h3>Strengths</h3><ul>{latestReview.strengths.map(item => <li key={item}>{item}</li>)}</ul>
              <h3>Gaps to revisit</h3><ul>{latestReview.gaps.map(item => <li key={item}>{item}</li>)}</ul>
              <h3>Next steps</h3><ul>{latestReview.nextSteps.map(item => <li key={item}>{item}</li>)}</ul>
              {latestReview.memories.length > 0 && <details><summary>What the tutor will remember</summary>
                <ul>{latestReview.memories.map(item => <li key={item}>{item}</li>)}</ul></details>}
              <Button variant="secondary" loading={planBusy} disabled={planBusy} onClick={() => { void generatePlan(); setView('path'); }}>
                Update plan from this review</Button>
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
          </div>
          <div className="journal-card"><h2>Exercise reflections</h2>
            {state.reflections?.length ? [...state.reflections].reverse().map(item => {
              const linked = catalog.find(candidate => candidate.id === item.exerciseId);
              return <article className="journal-entry" key={item.id}>
                <Button variant="plain" className="entry-title" onClick={() => selectExercise(item.exerciseId)}>{linked?.title || item.exerciseId} <ArrowRight size={15} /></Button>
                <small>{formatDate(item.createdAt)} · confidence {item.confidence}/5</small>
                <p>{item.notes || 'No written note for this reflection.'}</p>
                <PhotoSet ids={photoIds(item)} label="Reflection photo" onOpen={openPhoto} />
              </article>;
            }) : <p>Your reflections will appear here after you mark an exercise complete.</p>}
          </div>
          <div className="journal-card sessions-card"><h2>Exercise conversations</h2>
            {state.sessions.length ? [...state.sessions].reverse().map(session => {
              const linked = catalog.find(candidate => candidate.id === session.exerciseId);
              return <article className="journal-entry" key={session.id}>
                <Button variant="plain" className="entry-title" onClick={() => selectExercise(session.exerciseId)}>{linked?.title || session.exerciseId} <ArrowRight size={15} /></Button>
                <small>{formatDate(session.createdAt)} · {session.mode}</small>
                <p><strong>You:</strong> {session.requestText || (photoIds(session).length ? 'Photo of work' : 'No text')}</p>
                {photoIds(session).length ? <PhotoSet ids={photoIds(session)} label="Submitted work" onOpen={openPhoto} />
                  : <small>No photo was saved with this exchange.</small>}
                <div className="journal-tutor"><TutorBubble response={session.response} /></div>
              </article>;
            }) : <p>Your exercise conversations will appear here.</p>}
          </div>
          {!!state.lessonSessions?.length && <div className="journal-card sessions-card"><h2>Lesson conversations</h2>
            {[...state.lessonSessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(session => {
              const linked = allModules.find(module => module.id === session.moduleId);
              return <article className="journal-entry" key={session.id}>
                <Button variant="plain" className="entry-title" onClick={() => showLesson(session.moduleId)}>{linked?.title || session.moduleId} <ArrowRight size={15} /></Button>
                <small>{formatDate(session.createdAt)}</small>
                <div className="journal-lesson-question"><strong>You:</strong><Markdown>{session.requestText}</Markdown></div>
                <div className="journal-tutor"><TutorBubble response={session.response} /></div>
              </article>;
            })}
          </div>}
        </div>
        <p className="export-note">JSON export contains snapshot IDs and conversation records. Open photos here in the journal.</p>
        {actionError && <p className="page-error" role="alert">{actionError}</p>}
      </section>}
      {view === 'settings' && profileDraft && <section className="page">
        <div className="page-heading"><h1>Settings</h1><p>Set your pace and goal for future plans.</p></div>
        <div className="settings-form"><label>Your name<Input value={profileDraft.name}
          onChange={event => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label>
          <label>Your goal<Textarea rows={3} value={profileDraft.goal}
            onChange={event => setProfileDraft({ ...profileDraft, goal: event.target.value })} /></label>
          <div className="two-fields"><label>Minutes per session<Input type="number" min="10" max="180"
            value={profileDraft.sessionMinutes} onChange={event => setProfileDraft({ ...profileDraft, sessionMinutes: Number(event.target.value) })} /></label>
            <label>Sessions each week<Input type="number" min="1" max="7" value={profileDraft.sessionsPerWeek}
              onChange={event => setProfileDraft({ ...profileDraft, sessionsPerWeek: Number(event.target.value) })} /></label></div>
          <div className="form-field"><label htmlFor="tutor-language">Tutor language</label><Select id="tutor-language" value={profileDraft.language}
            onValueChange={value => setProfileDraft({ ...profileDraft, language: value as Profile['language'] })}
            options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }]} /></div>
          <Button variant="primary" loading={profileBusy} disabled={profileBusy} onClick={() => void saveProfile()}>
            {profileBusy ? 'Saving…' : 'Save preferences'}</Button>
          {profileMessage && <p className="status-line" role="status">{profileMessage}</p>}
        </div>
        {learning.data && <LearnerMemoryEditor data={learning.data} refresh={learning.refresh} />}
      </section>}
    </main>
    <Dialog open={!!photoOpen} onOpenChange={open => { if (!open) setPhotoOpen(null); }}>
      <DialogContent className="photo-overlay" showCloseButton={false} initialFocus={closePhotoRef} finalFocus={photoOpenerRef}>
        <DialogTitle className="sr-only">Submitted photo</DialogTitle>
        <DialogDescription className="sr-only">An enlarged view of your saved paper.</DialogDescription>
        <DialogClose ref={closePhotoRef} render={<Button variant="icon" className="photo-close" />} aria-label="Close photo"><X size={22} /></DialogClose>
        {photoOpen && <img src={photoSource(photoOpen)} alt="Submitted paper, enlarged" />}
      </DialogContent>
    </Dialog>
  </div>;
}
