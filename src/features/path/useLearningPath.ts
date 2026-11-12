import { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, Exercise, LessonChatRequest, LessonSession } from '../../../shared/types';
import { appStorage } from '../../storage';
import { courseModules, type Study } from '../../app/useStudy';
import { mergeSessions } from '../../app/session-state';
import { post, errorText } from '../../lib/api';
import { useLearning, learningApi, learningError } from '../../useLearning';
import { useLessonWorkspace } from './useLessonWorkspace';
import type { Navigation } from '../../app/useNavigation';
import { lessonPath } from '../../app/routes';
export type OutgoingLessonMessage = {
  id: string; createdAt: string; request: LessonChatRequest;
  status: 'sending' | 'failed'; error?: string;
};

const moduleKey = 'ari:selectedModuleId';
export function useLearningPath(study: Study, learning: ReturnType<typeof useLearning>, onSelectExercise: (id: string) => void, setActionError: (message: string) => void, navigation: Navigation) {
  const route = navigation.route;
  const workspace = useLessonWorkspace(route.tab, tab => {
    if (route.curriculumId && route.lessonId) navigation.go(lessonPath(route.curriculumId, route.lessonId, tab), true);
  });
  const { state, setState, allModules, catalog } = study;
  const [rememberedModuleId, rememberModule] = useState(() => {
    const saved = appStorage.getItem(moduleKey);
    return saved || courseModules[0]?.id || '';
  });
  const [rememberedCurriculumId, rememberCurriculum] = useState(() => appStorage.getItem('ari:curriculum') || '');
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [ficheRequests, setFicheRequests] = useState<Record<string, { pending: boolean; error?: string }>>({});
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, string>>({});
  const [outgoingLessonMessages, setOutgoingLessonMessages] = useState<OutgoingLessonMessage[]>([]);
  const lessonBusyRef = useRef(new Map<string, string>());
  const [generationDifficulty, setGenerationDifficulty] = useState<Difficulty>('stretch');
  const [generationBusy, setGenerationBusy] = useState(false);
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
  const completedLessonIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const exercise of catalog) {
      if (state?.progress[exercise.id]?.status === 'completed') {
        counts.set(exercise.moduleId, (counts.get(exercise.moduleId) ?? 0) + 1);
      }
    }
    return new Set(allModules.filter(module => (!('status' in module) || module.status === 'ready')
      && (counts.get(module.id) ?? 0) >= 2).map(module => module.id));
  }, [allModules, catalog, state?.progress]);
  const curriculumId = route.view === 'path' && route.curriculumId ? route.curriculumId : rememberedCurriculumId;
  const activeCurriculum = learning.data?.curricula.find(item => item.id === curriculumId)
    || (!route.curriculumId ? learning.data?.curricula.find(item => item.source === 'original') : undefined);
  const pathModules = activeCurriculum ? activeCurriculum.lessonIds.flatMap(id => allModules.find(item => item.id === id) ?? []) : [];
  const moduleId = route.view === 'path' && route.lessonId ? route.lessonId : rememberedModuleId;
  const selectedModule = pathModules.find(item => item.id === moduleId) || (!route.lessonId ? pathModules[0] : undefined);
  const selectedModuleId = selectedModule?.id || '';
  const selectedLesson = learning.data?.lessons.find(item => item.id === selectedModuleId);
  useEffect(() => {
    if (route.view !== 'path' || !activeCurriculum || !selectedModule || !route.lessonId) return;
    rememberModule(selectedModule.id); rememberCurriculum(activeCurriculum.id);
    appStorage.setItem(moduleKey, selectedModule.id);
    appStorage.setItem('ari:curriculum', activeCurriculum.id);
    appStorage.setItem('ari:lastLesson:' + activeCurriculum.id, selectedModule.id);
  }, [route.view, activeCurriculum?.id, selectedModuleId, route.lessonId]);
  const lessonSessions = useMemo(() => (state?.lessonSessions || []).filter(item => item.moduleId === selectedModuleId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [state?.lessonSessions, selectedModuleId]);
  const lessonOutgoing = useMemo(() => outgoingLessonMessages.filter(item => item.request.moduleId === selectedModuleId),
    [outgoingLessonMessages, selectedModuleId]);

  function showLesson(moduleId: string) {
    const owner = learning.data?.curricula.find(item => item.lessonIds.includes(moduleId));
    if (owner) navigation.go(lessonPath(owner.id, moduleId));
  }
  function setSelectedModuleId(moduleId: string) {
    if (activeCurriculum) navigation.go(lessonPath(activeCurriculum.id, moduleId));
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
      await learning.refresh();
    } catch (error) {
      setOutgoingLessonMessages(current => current.map(item => item.id === outgoing.id
        ? { ...item, status: 'failed', error: errorText(error) } : item));
    } finally {
      if (lessonBusyRef.current.get(moduleId) === outgoing.id) lessonBusyRef.current.delete(moduleId);
    }
  }
  function sendLessonMessage(images: string[] = []) {
    if (!selectedModule || lessonBusyRef.current.has(selectedModule.id) || lessonOutgoing.length) return false;
    const message = (lessonDrafts[selectedModule.id] || '').trim();
    if (!message && !images.length) return false;
    const id = crypto.randomUUID();
    const outgoing: OutgoingLessonMessage = {
      id, createdAt: new Date().toISOString(), status: 'sending',
      request: { id, moduleId: selectedModule.id, message, ...(images.length ? { images } : {}) },
    };
    setOutgoingLessonMessages(current => [...current, outgoing]);
    setLessonDrafts(current => ({ ...current, [selectedModule.id]: '' }));
    void deliverLessonMessage(outgoing);
    return true;
  }
  async function createFiche(moduleId: string) {
    if (ficheRequests[moduleId]?.pending) return;
    setFicheRequests(current => ({ ...current, [moduleId]: { pending: true } }));
    try {
      await learningApi('/lessons/' + encodeURIComponent(moduleId) + '/fiche', {});
      await learning.refresh();
      setFicheRequests(current => ({ ...current, [moduleId]: { pending: false } }));
    } catch (error) {
      setFicheRequests(current => ({ ...current, [moduleId]: { pending: false, error: errorText(error) } }));
    }
  }
  function dismissFicheError(moduleId: string) {
    setFicheRequests(current => ({ ...current, [moduleId]: { pending: false } }));
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

  return { workspace, activeCurriculum, completedLessonIds, pathModules, selectedModule, selectedLesson, selectedModuleId, setSelectedModuleId,
    prepareBusy, prepareLesson, ficheRequests, createFiche, dismissFicheError, lessonSessions, lessonOutgoing, lessonDrafts, setLessonDrafts,
    sendLessonMessage, deliverLessonMessage, generationBusy, generationDifficulty, setGenerationDifficulty,
    generateExercise, showLesson };
}
export type LearningPathController = ReturnType<typeof useLearningPath>;
