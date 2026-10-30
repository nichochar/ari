import { Card } from './components/ui/card';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Expand, Pause, Play, Plus, RefreshCw, RotateCw, Upload, X } from 'lucide-react';
import type { Curriculum, LearningLesson } from '../shared/learning';
import type { AssessmentListView, AssessmentReview, AssessmentSummary, AssessmentView } from '../shared/assessments';
import { Markdown } from './Markdown';
import { useCamera } from './useCamera';
import { appStorage } from './storage';
import { PageHeader } from './components/page-header';
import { ChatComposer, ChatMessage, ChatWaiting } from './components/chat';
import { Alert } from './components/ui/alert';
import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import { Select } from './components/ui/select';
import { Textarea } from './components/ui/textarea';
import { FileUpload } from './components/ui/file-upload';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { AriMark } from './components/ui/ari-mark';
import './assessments.css';

async function assessmentApi<T>(path = '', body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch('/api/assessments' + path, body === undefined ? { cache: 'no-store' } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not save this change. Try again.');
  return result as T;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
const photoSource = (id: string) => id.startsWith('data:image/') ? id : '/api/snapshots/' + encodeURIComponent(id);
const working = (view: AssessmentView) => ['planning', 'preparing', 'grading'].includes(view.status) || view.messages.some(message => message.status === 'pending');
const statusText: Record<AssessmentView['status'], string> = { planning: 'Planning', proposed: 'Ready to prepare', preparing: 'Preparing paper', active: 'In progress', paused: 'Paused', grading: 'Reviewing', reviewed: 'Reviewed', failed: 'Needs attention' };
const dateText = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
type ScopeDraft = { lessonIds: string[]; minutes: number; instructions: string };
type ChatRequest = { id: string; message: string; answer?: string; image?: string };
type SubmitRequest = { id: string; answer: string; image?: string };
type PageRequest = { id: string; image: string };
type Pending<T> = { body: T; error?: string; createdAt: string };
type LocalWork = { photo?: { image: string; name: string }; chat?: Pending<ChatRequest>; submit?: Pending<SubmitRequest>; page?: Pending<PageRequest> };
const localWork = new Map<string, LocalWork>();
function readDraft<T>(key: string, fallback: T): T {
  try { return JSON.parse(appStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function saveDraft(key: string, value: unknown) {
  try { appStorage.setItem(key, JSON.stringify(value)); } catch { /* The server still saves submitted work. */ }
}

export function Assessments({ curricula, lessons, initialCurriculumId }: {
  curricula: Curriculum[]; lessons: LearningLesson[]; initialCurriculumId?: string;
}) {
  const [list, setList] = useState<AssessmentListView | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => readDraft<string | null>('ari:assessment:selected', null));
  const [newOpen, setNewOpen] = useState(false);
  const [curriculumId, setCurriculumId] = useState(initialCurriculumId || curricula[0]?.id || '');
  const [creating, setCreating] = useState(false);
  const [createRequest, setCreateRequest] = useState<{ id: string; curriculumId: string } | null>(null);
  const refresh = useCallback(async () => {
    try { setList(await assessmentApi<AssessmentListView>()); setError(''); }
    catch (failure) { setError(errorText(failure)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { saveDraft('ari:assessment:selected', selectedId); }, [selectedId]);
  useEffect(() => {
    if (!list?.assessments.some(item => ['planning', 'preparing', 'grading'].includes(item.status))) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [list, refresh]);
  useEffect(() => { if (!curriculumId && curricula.length) setCurriculumId(initialCurriculumId || curricula[0].id); }, [curricula, curriculumId, initialCurriculumId]);
  const eligible = lessons.filter(lesson => lesson.curriculumId === curriculumId && lesson.status === 'ready');
  async function create() {
    if (creating || !curriculumId || !eligible.length) return;
    const request = createRequest || { id: crypto.randomUUID(), curriculumId };
    setCreateRequest(request); setCreating(true); setError('');
    try {
      const view = await assessmentApi<AssessmentView>('', request);
      setSelectedId(view.id); setNewOpen(false); setCreateRequest(null); void refresh();
    } catch (failure) { setError(errorText(failure)); }
    finally { setCreating(false); }
  }
  return <>
    {selectedId ? <AssessmentSession key={selectedId} id={selectedId} curricula={curricula} lessons={lessons}
      onBack={() => { setSelectedId(null); void refresh(); }} onChange={() => void refresh()} /> : <>
      <PageHeader title="Assessments" actions={<Button onClick={() => { setError(''); setNewOpen(true); }} disabled={!curricula.length}><Plus size={16} />New assessment</Button>} />
      {error && <Alert variant="destructive">{error} <Button variant="ghost" onClick={() => void refresh()}>Retry</Button></Alert>}
      {!list ? !error && <ChatWaiting label="Loading assessments" /> : list.assessments.length ? <div className="assessment-history">
        {list.assessments.map(item => <AssessmentHistoryItem key={item.id} item={item} curriculum={curricula.find(curriculum => curriculum.id === item.curriculumId)} onOpen={() => setSelectedId(item.id)} />)}
      </div> : <div className="assessment-empty"><AriMark size={44} /><h2>A fresh paper, at your pace</h2>
        <p>{curricula.length ? 'Choose a curriculum to put your learning into practice.' : 'Create a curriculum and prepare a lesson to begin.'}</p>
        {!!curricula.length && <Button variant="secondary" onClick={() => setNewOpen(true)}>New assessment</Button>}</div>}
    </>}
    <Dialog open={newOpen} onOpenChange={open => { if (!creating) setNewOpen(open); }}><DialogContent className="assessment-new-dialog">
      <DialogTitle>New assessment</DialogTitle><DialogDescription>Choose a curriculum. Ari will suggest a mix of topics from its prepared lessons.</DialogDescription>
      <label className="assessment-field">Curriculum<Select aria-label="Assessment curriculum" value={curriculumId} disabled={creating || !!createRequest}
        onValueChange={setCurriculumId} options={curricula.map(curriculum => ({ value: curriculum.id, label: curriculum.title }))} /></label>
      {!eligible.length && <p className="assessment-muted">Prepare at least one lesson in this curriculum first.</p>}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="assessment-actions"><Button loading={creating} disabled={!eligible.length || !list?.provider.configured}
        onClick={() => void create()}>{createRequest ? 'Retry planning' : 'Suggest topics'}</Button>
        {createRequest && !creating && <Button variant="ghost" onClick={() => setCreateRequest(null)}>Choose again</Button>}</div>
      {list && !list.provider.configured && <Alert variant="destructive">Connect a model in Settings to prepare an assessment.</Alert>}
    </DialogContent></Dialog>
  </>;
}

function AssessmentHistoryItem({ item, curriculum, onOpen }: { item: AssessmentSummary; curriculum?: Curriculum; onOpen: () => void }) {
  return <Card className="assessment-history-item"><div><div className="assessment-history-meta">{curriculum?.title || 'Curriculum'} · {dateText(item.createdAt)}</div>
    <h2>{item.title}</h2><p>{statusText[item.status]} · {item.minutes} min suggested{item.problemCount ? ` · ${item.problemCount} problems` : ''}
      {item.latestMaxScore !== null && ` · ${item.latestScore === null ? 'Not scored' : item.latestScore} / ${item.latestMaxScore}`}</p>
    {item.error && <p className="inline-error">{item.error}</p>}</div>
    <Button variant="secondary" onClick={onOpen}>{item.status === 'reviewed' ? 'Review' : item.status === 'paused' ? 'Resume' : 'Open'}</Button></Card>;
}

function AssessmentSession({ id, curricula, lessons, onBack, onChange }: {
  id: string; curricula: Curriculum[]; lessons: LearningLesson[]; onBack: () => void; onChange: () => void;
}) {
  const [view, setView] = useState<AssessmentView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const captureController = useRef<AbortController | null>(null);
  const uploadVersion = useRef(0);
  const [scope, setScope] = useState<ScopeDraft | null>(() => readDraft<ScopeDraft | null>('ari:assessment:scope:' + id, null));
  const [draft, setDraft] = useState(() => readDraft<string>('ari:assessment:chat:' + id, ''));
  const [answer, setAnswer] = useState<string | null>(() => readDraft<string | null>('ari:assessment:answer:' + id, null));
  const [work, setWork] = useState<LocalWork>(() => {
    const saved = localWork.get(id) || {};
    const next = saved.chat && !saved.chat.error ? { ...saved, chat: { ...saved.chat, error: 'Delivery is not confirmed yet. Retry to check this same message.' } } : saved;
    localWork.set(id, next);
    return next;
  });
  const workRef = useRef(work);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [photoOpen, setPhotoOpen] = useState<{ source: string; label: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [reviewId, setReviewId] = useState('');
  const camera = useCamera();
  function changeWork(change: Partial<LocalWork>, expected?: { field: 'chat' | 'submit' | 'page'; requestId: string }) {
    const current = localWork.get(id) || workRef.current;
    if (expected && current[expected.field]?.body.id !== expected.requestId) return;
    const next = { ...current, ...change };
    workRef.current = next; localWork.set(id, next);
    if (mounted.current) setWork(next);
  }
  const apply = useCallback((next: AssessmentView) => {
    if (!mounted.current) return;
    setView(current => current && current.updatedAt > next.updatedAt ? current : next);
    if (next.status === 'proposed') setScope(current => current || { lessonIds: next.lessonIds, minutes: next.minutes, instructions: next.instructions });
    setAnswer(current => current ?? next.answer);
  }, []);
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    try { const next = await assessmentApi<AssessmentView>('/' + encodeURIComponent(id)); if (!busyRef.current) apply(next); }
    catch (failure) { if (mounted.current) setError(errorText(failure)); }
  }, [id, apply]);
  useEffect(() => {
    mounted.current = true; void refresh();
    void fetch('/api/camera/status').then(response => response.json()).then(status => { if (mounted.current) setNativeAvailable(Boolean(status.available)); }).catch(() => undefined);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; uploadVersion.current++; captureController.current?.abort(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => {
    if (!view || !working(view)) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [view, refresh]);
  useEffect(() => { saveDraft('ari:assessment:chat:' + id, draft); }, [id, draft]);
  useEffect(() => { if (scope) saveDraft('ari:assessment:scope:' + id, scope); }, [id, scope]);
  useEffect(() => { if (answer !== null) saveDraft('ari:assessment:answer:' + id, answer); }, [id, answer]);
  useEffect(() => {
    if (!view || answer === null || answer === view.answer || !['active', 'paused', 'reviewed'].includes(view.status)) return;
    const timer = window.setTimeout(() => {
      if (busyRef.current) return;
      void assessmentApi<AssessmentView>('/' + id, { answer }, 'PATCH').then(apply).catch(failure => { if (mounted.current) setError('Your typed work is kept in this browser. Could not sync it: ' + errorText(failure)); });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [answer, view, id, apply, busy]);
  async function run(label: string, operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError('');
    try { await operation(); onChange(); }
    catch (failure) {
      const scopedError = label === 'chat' ? workRef.current.chat?.error : label === 'submit' ? workRef.current.submit?.error : label === 'page' ? workRef.current.page?.error : undefined;
      if (mounted.current && !scopedError && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(errorText(failure));
    }
    finally { busyRef.current = false; if (mounted.current) { setBusy(''); void refresh(); } }
  }
  async function mutate(path: string, body: unknown = {}, method = 'POST') { apply(await assessmentApi<AssessmentView>('/' + id + path, body, method)); }
  async function capture() {
    const controller = new AbortController(); captureController.current = controller;
    try { return await camera.captureWhenReady(nativeAvailable, controller.signal); }
    finally { if (captureController.current === controller) captureController.current = null; }
  }
  async function upload(file: File) {
    const version = ++uploadVersion.current;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPEG, PNG, or WebP photo.'); return; }
    if (file.size > 15_000_000) { setError('Choose a photo under 15 MB.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d'); if (!context) throw new Error('Could not open this photo. Try another file.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (mounted.current && version === uploadVersion.current) { camera.stop(); changeWork({ photo: { image: canvas.toDataURL('image/jpeg', .88), name: file.name } }); setError(''); setFallback(false); }
    } catch { if (mounted.current) setError('Could not open this photo. Try another JPEG, PNG, or WebP file.'); }
    finally { URL.revokeObjectURL(url); }
  }
  async function addPage() {
    await run('page', async () => {
      const pending = workRef.current.page || { body: { id: crypto.randomUUID(), image: workRef.current.photo?.image || await capture() }, createdAt: new Date().toISOString() };
      changeWork({ page: pending });
      try { await mutate('/pages', pending.body); changeWork({ page: undefined }, { field: 'page', requestId: pending.body.id }); }
      catch (failure) { changeWork({ page: { ...pending, error: errorText(failure) } }, { field: 'page', requestId: pending.body.id }); throw failure; }
    });
  }
  async function sendChat() {
    if (!view || (!draft.trim() && !workRef.current.photo && !camera.active) || workRef.current.chat) return;
    const text = draft.trim();
    let image = workRef.current.photo?.image;
    if (!image && camera.active) {
      image = camera.capture() || undefined;
      if (!image) { setError('The camera picture is not ready. Wait for your paper to appear, or stop the camera to send text only.'); return; }
    }
    const pending: Pending<ChatRequest> = { body: { id: crypto.randomUUID(), message: text || 'Here is my work so far.', answer: answer || '', ...(image ? { image } : {}) }, createdAt: new Date().toISOString() };
    changeWork({ chat: pending }); setDraft('');
    await deliverChat(pending);
  }
  async function deliverChat(pending: Pending<ChatRequest>) {
    await run('chat', async () => {
      changeWork({ chat: { ...pending, error: undefined } }, { field: 'chat', requestId: pending.body.id });
      try { await mutate('/chat', pending.body); changeWork({ chat: undefined }, { field: 'chat', requestId: pending.body.id }); }
      catch (failure) { changeWork({ chat: { ...pending, error: errorText(failure) } }, { field: 'chat', requestId: pending.body.id }); throw failure; }
    });
  }
  async function submit(savedOnly = false) {
    if (!view) return;
    await run('submit', async () => {
      let pending = workRef.current.submit;
      if (!pending) {
        let image = savedOnly ? undefined : workRef.current.photo?.image;
        if (!savedOnly && !image && (camera.active || !(answer || '').trim())) {
          try { image = await capture(); }
          catch (failure) { if (mounted.current) setFallback(true); throw failure; }
        }
        if (!image && !(answer || '').trim() && !view.pages.length) throw new Error('Add a photo or type your work before submitting.');
        pending = { body: { id: crypto.randomUUID(), answer: answer || '', ...(image ? { image } : {}) }, createdAt: new Date().toISOString() };
        changeWork({ submit: pending });
      }
      try { await mutate('/submit', pending.body); changeWork({ submit: undefined }, { field: 'submit', requestId: pending.body.id }); setFallback(false); setReviewId(''); }
      catch (failure) { changeWork({ submit: { ...pending, error: errorText(failure) } }, { field: 'submit', requestId: pending.body.id }); throw failure; }
    });
  }
  const chatLog = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
  useEffect(() => {
    const log = chatLog.current;
    if (log && followChat.current) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  }, [view?.messages.length, work.chat]);
  const hasPaper = Boolean(view?.problems.length);
  const serverBusy = Boolean(view && working(view));
  const locked = !!busy || serverBusy;
  const writable = view?.status === 'active';
  const canChat = !!view && ['active', 'reviewed'].includes(view.status);
  const reviews = view?.submissions.filter(item => item.status === 'complete' && item.review) || [];
  const selectedReview = reviews.find(item => item.id === reviewId) || reviews.at(-1);
  const chatPendingSaved = view?.messages.some(item => item.id === work.chat?.body.id);
  const submitPendingSaved = view?.submissions.some(item => item.id === work.submit?.body.id);
  const latestSubmission = view?.submissions.at(-1);
  const failedReply = view?.messages.filter(message => message.role === 'assistant' && message.status === 'failed').at(-1);
  const failedReplyIndex = view?.messages.findIndex(message => message.id === failedReply?.id) ?? -1;
  const failedUser = failedReplyIndex > 0 ? view?.messages.slice(0, failedReplyIndex).filter(message => message.role === 'user').at(-1) : undefined;
  const canRetryReply = !!failedReply && view?.messages.at(-1)?.id === failedReply.id && !view.submissions.some(submission => submission.messageIds.includes(failedReply.id));
  useEffect(() => {
    if (!view) return;
    const current = workRef.current;
    const change: Partial<LocalWork> = {};
    if (current.chat && view.messages.some(message => message.id === current.chat!.body.id)) change.chat = undefined;
    if (current.submit && view.submissions.some(submission => submission.id === current.submit!.body.id)) change.submit = undefined;
    if (current.page && view.pages.some(page => page.id === current.page!.body.id)) change.page = undefined;
    if (Object.keys(change).length) changeWork(change);
  }, [view]);
  const cameraTransform = { transform: `translate(-50%, -50%) rotate(${camera.rotation}deg) scaleX(${camera.mirrored ? -1 : 1})` };
  return <>
    <div className="assessment-back"><Button variant="ghost" onClick={onBack}><ArrowLeft size={15} />Assessments</Button></div>
    <PageHeader title={view?.title || 'Assessment'} description={view ? curricula.find(item => item.id === view.curriculumId)?.title : undefined}
      actions={view && <>{hasPaper && <span className="assessment-status">{statusText[view.status]} · {view.minutes} min suggested</span>}
        {view.status === 'active' && <Button variant="secondary" disabled={locked} onClick={() => void run('pause', async () => { await mutate('', { answer: answer || '' }, 'PATCH'); await mutate('/pause'); })}><Pause size={15} />Pause</Button>}
        {(view.status === 'paused' || view.status === 'reviewed') && <Button variant="secondary" disabled={locked} onClick={() => void run('resume', () => mutate('/resume'))}><Play size={15} />{view.status === 'reviewed' ? 'Revise answers' : 'Resume'}</Button>}</>} />
    {error && <Alert variant="destructive" onDismiss={() => setError('')}>{error}{!view && <Button variant="ghost" onClick={() => { setError(''); void refresh(); }}>Retry loading</Button>}</Alert>}
    {!view ? !error && <ChatWaiting label="Loading assessment" /> : <>
      {view.status === 'failed' && <Alert variant="destructive">{view.error || 'Ari could not finish this step. Your work is saved.'}
        <Button variant="secondary" loading={busy === 'retry'} disabled={locked} onClick={() => void run('retry', () => mutate('/retry'))}>Try again</Button></Alert>}
      {['planning', 'preparing'].includes(view.status) && <div className="assessment-progress"><ChatWaiting label={view.status === 'planning' ? 'Ari is suggesting topics' : 'Ari is preparing your paper'} />
        <p>{view.status === 'planning' ? 'Ari is suggesting a mix of topics…' : 'Ari is preparing your paper…'}</p></div>}
      {view.status === 'proposed' && scope && <Card className="assessment-proposal">
        <h2>Your topic mix</h2><Markdown>{view.scopeReason}</Markdown>
        <div className="assessment-topics">{lessons.filter(lesson => lesson.curriculumId === view.curriculumId && lesson.status === 'ready').map(lesson => <label key={lesson.id}>
          <Checkbox disabled={locked} checked={scope.lessonIds.includes(lesson.id)} onCheckedChange={checked => setScope(current => current && ({ ...current, lessonIds: checked ? [...current.lessonIds, lesson.id] : current.lessonIds.filter(item => item !== lesson.id) }))} />
          <span>{lesson.title}</span></label>)}</div>
        <label className="assessment-field assessment-duration">Suggested duration<Select value={String(scope.minutes)} onValueChange={value => setScope(current => current && ({ ...current, minutes: Number(value) }))}
          disabled={locked} aria-label="Suggested assessment duration" options={[...new Set([15, 30, 45, 60, 90, 120, scope.minutes])].sort((a, b) => a - b).map(minutes => ({ value: String(minutes), label: `${minutes} minutes` }))} /></label>
        <label className="assessment-field">Adjust the paper<Textarea rows={2} maxLength={2000} value={scope.instructions} placeholder="More applications, less algebra…" disabled={locked}
          onChange={event => setScope(current => current && ({ ...current, instructions: event.target.value }))} /></label>
        <div className="assessment-actions"><Button loading={busy === 'prepare'} disabled={locked || !scope.lessonIds.length}
          onClick={() => void run('prepare', async () => { await mutate('', scope, 'PATCH'); await mutate('/prepare'); })}>Prepare paper</Button></div>
      </Card>}
      {view.status === 'paused' && <Alert>Your paper and work are saved. Resume when you are ready.</Alert>}
      {hasPaper && <div className="assessment-grid"><div className="assessment-main">
        <Card as="article" className="assessment-paper"><div className="assessment-paper-heading"><h2>Assessment paper</h2><span>{view.problems.reduce((sum, problem) => sum + problem.points, 0)} points</span></div>
          {view.problems.map((problem, index) => <section className="assessment-problem" key={problem.id}><div className="assessment-problem-heading"><h3>{index + 1}. {problem.title}</h3><span>{problem.points} points</span></div><Markdown>{problem.prompt}</Markdown></section>)}
        </Card>
        {!!reviews.length && selectedReview?.review && <Card as="section" className="assessment-review">
          <div className="assessment-review-heading"><h2>Review</h2><Select compact aria-label="Review submission" value={selectedReview.id} onValueChange={setReviewId}
            options={reviews.map((submission, index) => ({ value: submission.id, label: `Submission ${index + 1} · ${dateText(submission.createdAt)}` }))} /></div>
          <Review review={selectedReview.review} view={view} />
          <details className="assessment-original"><summary>Submitted work</summary>{selectedReview.answer && <Markdown>{selectedReview.answer}</Markdown>}
            <div className="assessment-message-photos">{selectedReview.snapshotIds.map((snapshotId, index) => <Button key={snapshotId} variant="plain" onClick={() => setPhotoOpen({ source: photoSource(snapshotId), label: `Submitted page ${index + 1}` })}><img src={photoSource(snapshotId)} alt={`Submitted page ${index + 1}`} loading="lazy" /></Button>)}</div></details>
        </Card>}
        <Card as="section" className="conversation-panel assessment-chat"><div className="panel-heading"><h2>Talk with Ari</h2></div>
          <div ref={chatLog} className="assessment-chat-messages" role="log" aria-label="Assessment conversation" aria-live="polite"
            onScroll={event => { const log = event.currentTarget; followChat.current = log.scrollHeight - log.scrollTop - log.clientHeight < 100; }}>
            {!view.messages.length && !work.chat && <p className="assessment-muted">Ask about a problem or share your reasoning.</p>}
            {view.messages.filter(message => message.content || message.snapshotIds.length).map(message => <ChatMessage key={message.id} author={message.role} createdAt={message.createdAt}>
              {message.content && <Markdown>{message.content}</Markdown>}
              {!!message.snapshotIds.length && <div className="assessment-message-photos">{message.snapshotIds.map((snapshotId, index) => <Button key={snapshotId} variant="plain" onClick={() => setPhotoOpen({ source: photoSource(snapshotId), label: `Message photo ${index + 1}` })}><img src={photoSource(snapshotId)} alt={`Message photo ${index + 1}`} loading="lazy" /></Button>)}</div>}
            </ChatMessage>)}
            {work.chat && !chatPendingSaved && <ChatMessage author="user" createdAt={work.chat.createdAt}>{work.chat.body.message && <Markdown>{work.chat.body.message}</Markdown>}
              {work.chat.body.image && <div className="assessment-message-photos"><img src={work.chat.body.image} alt="Photo attached to your message" /></div>}</ChatMessage>}
            {(busy === 'chat' || view.messages.some(message => message.status === 'pending')) && <ChatWaiting />}
            {work.chat?.error && <Alert variant="destructive">{work.chat.error}<Button variant="secondary" disabled={locked} onClick={() => void deliverChat(work.chat!)}>Retry this message</Button></Alert>}
            {failedReply && !work.chat && <Alert variant="destructive">{failedReply.error || 'Ari could not answer. Your message and photos are saved.'}
              {canRetryReply && failedUser ? <Button variant="secondary" disabled={locked} onClick={() => void run('chat', () => mutate('/messages/' + encodeURIComponent(failedUser.id) + '/retry'))}>Retry reply</Button> : <span> Send a new message to continue.</span>}</Alert>}
          </div>
          <ChatComposer value={draft} onChange={setDraft} onSend={() => void sendChat()} label="Assessment message" placeholder="Ask Ari about your work…" maxLength={4000}
            sendDisabled={!canChat || locked || !!work.chat || (!draft.trim() && !work.photo && !camera.active)}
            beforeInput={(camera.active || work.photo) && <p className="composer-attachment"><Camera size={14} />Current photo included</p>} />
        </Card>
      </div><aside className="assessment-work">
        <Card as="section" className="camera-panel"><div className="panel-heading"><h2>Your work</h2><Button variant="icon" aria-label="Expand paper preview" onClick={() => setExpanded(true)}><Expand size={18} /></Button></div>
          <div className={'camera-stage ' + (camera.rotation % 180 ? 'portrait' : '')}><div className="camera-image-area">
            {work.photo ? <img className="uploaded-preview" src={work.photo.image} alt="Current uploaded work" /> : camera.active ? <div className={'video-frame ' + (camera.rotation % 180 ? 'sideways' : '')}>
              {camera.mode === 'native' ? camera.nativeFrameUrl ? <img ref={camera.nativeImageRef} src={camera.nativeFrameUrl} alt="Live IPEVO paper preview" style={cameraTransform} /> : <ChatWaiting label="Connecting camera" />
                : <video ref={camera.videoRef} autoPlay muted playsInline style={cameraTransform} />}</div>
              : <div className="camera-placeholder"><Camera size={28} /><strong>Show your paper</strong><div>{nativeAvailable && <Button variant="secondary" loading={camera.starting} disabled={locked || camera.starting} onClick={() => void camera.startNative()}>Use IPEVO</Button>}
                <Button variant="secondary" disabled={locked || camera.starting} loading={camera.starting && !nativeAvailable} onClick={() => void camera.start()}>Use camera</Button></div></div>}
          </div>{camera.active && !work.photo && <div className="camera-controls">
            {camera.mode === 'browser' && !!camera.devices.length && <Select compact aria-label="Camera device" value={camera.deviceId} disabled={locked} onValueChange={value => void camera.start(value)} options={camera.devices.map(device => ({ value: device.deviceId, label: device.label || 'Camera' }))} />}
            <div><Button variant="icon" aria-label="Rotate camera" disabled={locked} onClick={() => camera.setRotation(value => (value + 90) % 360)}><RotateCw size={17} /></Button>
              <Button variant="icon" aria-label="Mirror camera" disabled={locked} onClick={() => camera.setMirrored(value => !value)}><RefreshCw size={17} /></Button>
              <Button variant="icon" aria-label="Stop camera" disabled={locked} onClick={camera.stop}><Pause size={17} /></Button></div>
          </div>}</div>
          {camera.error && <Alert variant="destructive" className="camera-error" onDismiss={camera.dismissError}>{camera.error}</Alert>}
          <div className="upload-row"><FileUpload label="Upload photo" accept="image/jpeg,image/png,image/webp" disabled={locked || !writable} onFile={file => void upload(file)}><Upload size={15} />Upload</FileUpload>
            <Button variant="ghost" disabled={locked || !writable} loading={busy === 'page'} onClick={() => void addPage()}><Plus size={15} />{work.page ? 'Retry saving page' : 'Add page'}</Button></div>
          {work.photo && <div className="upload-selected"><span>{work.photo.name}</span><Button variant="icon" aria-label="Clear current uploaded photo" disabled={locked} onClick={() => changeWork({ photo: undefined })}><X size={15} /></Button></div>}
          {work.page?.error && <Alert className="camera-error" variant="destructive">The captured page is kept here. {work.page.error}</Alert>}
          {!!view.pages.length && <div className="saved-pages"><div className="saved-pages-list" aria-label="Saved assessment pages">{view.pages.map((page, index) => <div className="saved-page" key={page.id}>
            <Button variant="plain" className="saved-page-photo" aria-label={`View saved page ${index + 1}`} onClick={() => setPhotoOpen({ source: photoSource(page.snapshotId), label: `Saved page ${index + 1}` })}><img src={photoSource(page.snapshotId)} alt={`Saved page ${index + 1}`} loading="lazy" /><span>{index + 1}</span></Button>
            <span className="saved-page-remove-wrap"><Button variant="plain" className="saved-page-remove" aria-label={`Remove saved page ${index + 1}`} disabled={locked || !writable || !!work.chat || !!work.submit}
              onClick={() => void run('remove', async () => { apply(await assessmentApi<AssessmentView>('/' + id + '/pages/' + encodeURIComponent(page.id), {}, 'DELETE')); })}><X size={13} /></Button></span>
          </div>)}</div></div>}
        </Card>
        <Card as="section" className="assessment-submit"><label className="assessment-field">Typed work<Textarea value={answer || ''} onChange={event => setAnswer(event.target.value)} rows={5} maxLength={20000} disabled={!writable || locked} placeholder="Write your answers or add notes for your paper…" /></label>
          <Button disabled={!writable || locked || !!work.page} loading={busy === 'submit'} onClick={() => void submit()}>{busy === 'submit' ? 'Preparing submission…' : work.submit ? 'Retry this submission' : reviews.length ? 'Submit revised work' : 'Submit for review'}</Button>
          {view.status === 'grading' && <div className="assessment-grading"><ChatWaiting label="Ari is reviewing your submission" /><p>Ari is reviewing your work…</p></div>}
          {work.submit?.error && <Alert variant="destructive">{work.submit.error}{submitPendingSaved && ' Your submission was saved.'}</Alert>}
          {latestSubmission?.status === 'failed' && !work.submit && view.status !== 'failed' && <Alert variant="destructive">{latestSubmission.error || 'Review failed. Your work is saved.'}<Button variant="secondary" disabled={locked} onClick={() => void run('retry', () => mutate('/retry'))}>Retry review</Button></Alert>}
          {fallback && ((answer || '').trim() || view.pages.length > 0) && <Button variant="secondary" disabled={locked} onClick={() => void submit(true)}>Submit {view.pages.length ? 'saved pages' : 'typed work'}{view.pages.length && (answer || '').trim() ? ' and typed work' : ''} only</Button>}
        </Card>
      </aside></div>}
    </>}
    <Dialog open={!!photoOpen} onOpenChange={open => { if (!open) setPhotoOpen(null); }}><DialogContent className="assessment-photo-dialog"><DialogTitle>{photoOpen?.label || 'Paper photo'}</DialogTitle><DialogDescription>Saved with this assessment.</DialogDescription>{photoOpen && <img src={photoOpen.source} alt={photoOpen.label} />}</DialogContent></Dialog>
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="assessment-photo-dialog"><DialogTitle>Paper preview</DialogTitle><DialogDescription>Camera preview stays local until you send, add a page, or submit.</DialogDescription>
      {work.photo ? <img src={work.photo.image} alt="Current uploaded work" /> : camera.active ? <ExpandedCamera camera={camera} /> : <p>Start a camera or upload a photo to preview your paper.</p>}
    </DialogContent></Dialog>
  </>;
}

function ExpandedCamera({ camera }: { camera: ReturnType<typeof useCamera> }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const source = camera.videoRef.current;
    const sync = () => {
      const target = video.current;
      const stream = camera.active && camera.mode === 'browser' ? source?.srcObject || null : null;
      if (!target || target.srcObject === stream) return;
      target.srcObject = stream;
      if (stream) void target.play().catch(() => undefined);
    };
    sync();
    const frame = requestAnimationFrame(sync);
    source?.addEventListener('loadedmetadata', sync);
    return () => { cancelAnimationFrame(frame); source?.removeEventListener('loadedmetadata', sync); };
  }, [camera.active, camera.mode, camera.deviceId, camera.starting, camera.videoRef]);
  return <div className={'assessment-expanded-camera video-frame ' + (camera.rotation % 180 ? 'sideways' : '')}>{camera.mode === 'native'
    ? camera.nativeFrameUrl && <img src={camera.nativeFrameUrl} alt="Expanded live paper" style={{ transform: `translate(-50%, -50%) rotate(${camera.rotation}deg) scaleX(${camera.mirrored ? -1 : 1})` }} />
    : <video ref={video} autoPlay muted playsInline style={{ transform: `translate(-50%, -50%) rotate(${camera.rotation}deg) scaleX(${camera.mirrored ? -1 : 1})` }} />}</div>;
}

function Review({ review, view }: { review: AssessmentReview; view: AssessmentView }) {
  return <><div className="assessment-score">{review.score === null ? <strong>Not scored</strong> : <><strong>{review.score}</strong><span> / {review.maxScore}</span></>}</div>
    <Markdown>{review.summary}</Markdown>
    <div className="assessment-problem-reviews">{review.problems.map((result, index) => <div key={result.problemId}><div className="assessment-problem-heading"><h3>{index + 1}. {view.problems.find(problem => problem.id === result.problemId)?.title || 'Problem'}</h3><span>{result.score === null ? 'Not scored' : `${result.score} / ${result.maxScore}`}</span></div><Markdown>{result.feedback}</Markdown>
      {result.criteria.length > 0 && <details><summary>Marking details</summary>{result.criteria.map((criterion, criterionIndex) => <p key={criterionIndex}><strong>{criterion.criterion}: {criterion.awarded} / {criterion.max}</strong><br />{criterion.comment}</p>)}</details>}</div>)}</div>
    {[['Strengths', review.strengths], ['Gaps', review.gaps], ['Next steps', review.nextSteps]].map(([title, items]) => (items as string[]).length > 0 && <div className="assessment-review-notes" key={title as string}><h3>{title}</h3><ul>{(items as string[]).map((item, index) => <li key={index}><Markdown>{item}</Markdown></li>)}</ul></div>)}
    {review.helpSummary && <div className="assessment-help-summary"><h3>Help used</h3><Markdown>{review.helpSummary}</Markdown></div>}
  </>;
}
