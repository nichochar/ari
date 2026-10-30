import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject, Dispatch, SetStateAction } from 'react';
import type { AppState, Exercise, ExercisePage, ReflectionResponse, Session, TutorRequest } from '../../../shared/types';
import { MAX_EXERCISE_PAGES } from '../../../shared/types';
import { api, post, errorText } from '../../lib/api';
import { mergeSessions } from '../../app/session-state';
import { useCamera } from '../../useCamera';
type TutorMode = 'chat' | 'check';
type OutgoingMessage = {
  id: string; createdAt: string; request: TutorRequest;
  pageSnapshotIds: string[];
  status: 'sending' | 'failed'; error?: string;
};
type UnsavedPage = { id: string; image: string; error: string };

type DeskOptions = {
  active: boolean; state: AppState | null; setState: Dispatch<SetStateAction<AppState | null>>;
  exercise: Exercise | undefined; selectedId: string; selectedIdRef: RefObject<string>;
  nativeAvailable: boolean; onIdle: () => void; setActionError: (message: string) => void;
};
export function useDesk({ active, state, setState, exercise, selectedId, selectedIdRef, nativeAvailable, onIdle, setActionError }: DeskOptions) {
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
  const [confidence, setConfidence] = useState<number | null>(null);
  const [reflectionNotes, setReflectionNotes] = useState('');
  const [reflectionBusy, setReflectionBusy] = useState(false);
  const reflectionBusyRef = useRef(false);
  const [reflectionMessage, setReflectionMessage] = useState('');
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeCameraRef = useRef<HTMLButtonElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const shouldFollowConversation = useRef(true);
  const camera = useCamera();
  useEffect(() => {
    if (!active) {
      gradeCaptureRef.current?.abort();
      camera.stop();
      setCameraExpanded(false);
    }
  }, [active, camera.stop]);
  useEffect(() => () => gradeCaptureRef.current?.abort(), []);
  const progress = exercise ? state?.progress[exercise.id] : undefined;
  const reflectionReady = !!state && !!exercise;
  const pages = useMemo(() => (state?.exercisePages || []).filter(item => item.exerciseId === selectedId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.exercisePages, selectedId]);
  const pageError = pageErrors[selectedId] || '';
  const retryPages = unsavedPages[selectedId] || [];
  const sessions = useMemo(() => (state?.sessions || []).filter(item => item.exerciseId === selectedId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.sessions, selectedId]);
  const conversation = useMemo(() => {
    const entries: { id: string; createdAt: string; session?: Session; outgoing?: OutgoingMessage }[] = [
      ...sessions.map(session => ({ id: session.id, createdAt: session.createdAt, session })),
      ...outgoingMessages.filter(item => item.request.exerciseId === selectedId && !sessions.some(session => session.id === item.id))
        .map(outgoing => ({ id: outgoing.id, createdAt: outgoing.createdAt, outgoing })),
    ];
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [sessions, outgoingMessages, selectedId]);
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
  }, [conversation, selectedId, active]);
  useEffect(() => {
    if (!reflectionReady) return;
    setConfidence(progress?.confidence || null);
    const reflection = [...(state?.reflections || [])].reverse().find(item => item.exerciseId === selectedId);
    setReflectionNotes(reflection?.notes || '');
    setReflectionMessage('');
  }, [selectedId, reflectionReady]); // Deliberately do not reset notes when state refreshes.

  function cancelCapture() { gradeCaptureRef.current?.abort(); }
  function invalidateUpload() { uploadReadRef.current++; }
  function resetForExercise() {
    cancelCapture();
    invalidateUpload();
    setDraft('');
    setUploadedImage(null);
    setUploadName('');
    setSendError('');
    setCameraExpanded(false);
    shouldFollowConversation.current = true;
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
    const id = crypto.randomUUID();
    const outgoing: OutgoingMessage = {
      id, createdAt: new Date().toISOString(), status: 'sending',
      pageSnapshotIds: submittedPages.map(page => page.snapshotId),
      request: { id, exerciseId, mode,
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
    try {
      const session = await post<Session>('/api/tutor', outgoing.request);
      setState(current => {
        if (!current) return current;
        const previous = current.progress[session.exerciseId];
        const added = !current.sessions.some(item => item.id === session.id);
        const sessions = mergeSessions(current.sessions, [session]);
        const lastScored = sessions.filter(item => item.exerciseId === session.exerciseId && item.response.score !== null).at(-1);
        return { ...current, sessions,
          progress: added ? { ...current.progress, [session.exerciseId]: {
            ...(previous ?? { exerciseId: session.exerciseId, status: 'started', confidence: 0, nextReviewAt: null }),
            updatedAt: previous && previous.updatedAt > session.createdAt ? previous.updatedAt : session.createdAt,
            hintCount: (previous?.hintCount ?? 0) + (session.mode === 'hint' ? 1 : 0),
            lastScore: lastScored?.response.score ?? previous?.lastScore ?? null,
          } } : current.progress };
      });
      setOutgoingMessages(current => current.filter(item => item.id !== outgoing.id));
    } catch (error) {
      setOutgoingMessages(current => current.map(item => item.id === outgoing.id
        ? { ...item, status: 'failed', error: errorText(error) } : item));
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
  async function saveReflection() {
    if (!exercise || confidence === null || reflectionBusyRef.current || pageBusyRef.current || sendBusyRef.current) return;
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
      onIdle();
    } catch (error) {
      if (selectedIdRef.current === exerciseId) setReflectionMessage('Could not save reflection: ' + errorText(error));
    } finally { reflectionBusyRef.current = false; setReflectionBusy(false); }
  }

  return { draft, setDraft, uploadedImage, setUploadedImage, uploadName, setUploadName, sendMode,
    preparingGrade, sendError, pageBusy, pages, pageError, retryPages, conversation, progress,
    confidence, setConfidence, reflectionNotes, setReflectionNotes, reflectionBusy, reflectionMessage,
    cameraExpanded, setCameraExpanded, expandButtonRef, closeCameraRef, conversationRef, composerRef,
    shouldFollowConversation, camera, pageAttachedToPendingMessage, addPage, removePage,
    send, deliverMessage, onUpload, saveReflection, cancelCapture, invalidateUpload, resetForExercise };
}
export type DeskController = ReturnType<typeof useDesk>;
