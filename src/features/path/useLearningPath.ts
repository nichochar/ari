import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, Exercise, LessonChatRequest, LessonSession } from '../../../shared/types';
import { appStorage } from '../../storage';
import { courseModules, type Study } from '../../app/useStudy';
import { mergeSessions } from '../../app/session-state';
import { post, errorText } from '../../lib/api';
import { useLearning, learningApi, learningError } from '../../useLearning';
export type OutgoingLessonMessage = {
  id: string; createdAt: string; request: LessonChatRequest;
  status: 'sending' | 'failed'; error?: string;
};

const moduleKey = 'ari:selectedModuleId';
export function useLearningPath(study: Study, learning: ReturnType<typeof useLearning>, onSelectExercise: (id: string) => void, setActionError: (message: string) => void) {
  const { state, setState, allModules, catalog } = study;
  const [selectedModuleId, setSelectedModuleId] = useState(() => {
    const saved = appStorage.getItem(moduleKey);
    return saved || courseModules[0]?.id || '';
  });
  const [curriculumId, setCurriculumId] = useState(() => appStorage.getItem('ari:curriculum') || '');
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, string>>({});
  const [outgoingLessonMessages, setOutgoingLessonMessages] = useState<OutgoingLessonMessage[]>([]);
  const lessonBusyRef = useRef(new Map<string, string>());
  const [generationDifficulty, setGenerationDifficulty] = useState<Difficulty>('stretch');
  const [generationBusy, setGenerationBusy] = useState(false);
  useEffect(() => { appStorage.setItem(moduleKey, selectedModuleId); }, [selectedModuleId]);
  useEffect(() => { appStorage.setItem('ari:curriculum', curriculumId); }, [curriculumId]);
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
  const activeCurriculum = learning.data?.curricula.find(item => item.id === curriculumId) || learning.data?.curricula.find(item => item.source === 'original');
  const pathModules = activeCurriculum ? allModules.filter(item => activeCurriculum.lessonIds.includes(item.id)) : courseModules;
  const selectedModule = pathModules.find(item => item.id === selectedModuleId) || pathModules[0];
  const selectedLesson = learning.data?.lessons.find(item => item.id === selectedModule?.id);
  useEffect(() => { if (learning.data && selectedModule && selectedModule.id !== selectedModuleId) setSelectedModuleId(selectedModule.id); }, [learning.data, selectedModule, selectedModuleId]);
  const lessonSessions = useMemo(() => (state?.lessonSessions || []).filter(item => item.moduleId === selectedModuleId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.lessonSessions, selectedModuleId]);
  const lessonOutgoing = useMemo(() => outgoingLessonMessages.filter(item => item.request.moduleId === selectedModuleId),
    [outgoingLessonMessages, selectedModuleId]);

  function showLesson(moduleId: string) {
    const owner = learning.data?.curricula.find(item => item.lessonIds.includes(moduleId));
    if (owner) setCurriculumId(owner.id);
    setSelectedModuleId(moduleId);
  }
  function openCurriculum(id: string) {
    setCurriculumId(id);
    setSelectedModuleId(learning.data?.curricula.find(item => item.id === id)?.lessonIds[0] || '');
  }
  async function prepareLesson() {
    if (!selectedModule || prepareBusy) return; setPrepareBusy(true); setActionError('');
    try { await learningApi('/lessons/' + encodeURIComponent(selectedModule.id) + '/prepare', {}); await learning.refresh(); }
    catch (failure) { setActionError(learningError(failure)); } finally { setPrepareBusy(false); }
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
        lessonSessions: mergeSessions(current.lessonSessions, [session]),
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
      request: { id, moduleId: selectedModule.id, message },
    };
    setOutgoingLessonMessages(current => [...current, outgoing]);
    setLessonDrafts(current => ({ ...current, [selectedModule.id]: '' }));
    void deliverLessonMessage(outgoing);
  }
  async function generateExercise(moduleId: string, difficulty: Difficulty) {
    if (generationBusy) return;
    setGenerationBusy(true);
    setActionError('');
    try {
      const next = await post<Exercise>('/api/exercises/generate', { moduleId, difficulty });
      setState(current => current ? { ...current, generatedExercises: [...current.generatedExercises, next] } : current);
      onSelectExercise(next.id);
    } catch (error) { setActionError(errorText(error)); }
    finally { setGenerationBusy(false); }
  }

  return { activeCurriculum, pathModules, selectedModule, selectedLesson, selectedModuleId, setSelectedModuleId,
    prepareBusy, prepareLesson, lessonSessions, lessonOutgoing, lessonDrafts, setLessonDrafts,
    sendLessonMessage, deliverLessonMessage, generationBusy, generationDifficulty, setGenerationDifficulty,
    generateExercise, showLesson, openCurriculum };
}
export type LearningPathController = ReturnType<typeof useLearningPath>;
