import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { appStorage } from '../storage';
import { diagnosticIds, exercises, modules } from '../../shared/curriculum';
import type { AppState, Exercise, Health, Module } from '../../shared/types';
import type { LearningView } from '../../shared/learning';
import { api, errorText } from '../lib/api';
import { mergeSessions } from './session-state';
const curated = exercises as Exercise[];
export const courseModules = modules as Module[];
const selectedKey = 'ari:selectedExerciseId';

export function useStudy(learningData: LearningView | null) {
  const [state, setState] = useState<AppState | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const selectedIdRef = useRef('');
  const restoredExerciseRef = useRef(appStorage.getItem(selectedKey));
  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [next, nextHealth, native] = await Promise.all([
        api<AppState>('/api/state', undefined, 30000),
        api<Health>('/api/health', undefined, 30000),
        api<{ available: boolean }>('/api/camera/status', undefined, 10000).catch(() => ({ available: false })),
      ]);
      const catalog = [...curated, ...next.generatedExercises];
      const saved = appStorage.getItem(selectedKey);
      const nextId = saved && catalog.some(item => item.id === saved)
        ? saved
        : diagnosticIds.find(id => next.progress[id]?.status !== 'completed')
          || catalog.find(item => next.progress[item.id]?.status !== 'completed')?.id
          || catalog[0]?.id || '';
      selectedIdRef.current = nextId;
      if (nextId) appStorage.setItem(selectedKey, nextId);
      setSelectedId(nextId);
      setState(current => ({ ...next, sessions: mergeSessions(current?.sessions, next.sessions), lessonSessions: mergeSessions(current?.lessonSessions, next.lessonSessions) }));
      setHealth(nextHealth);
      setNativeAvailable(native.available);
    } catch (error) {
      setLoadError(errorText(error));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const allModules = useMemo(() => [...new Map([...courseModules, ...(learningData?.lessons || [])].map(item => [item.id, item])).values()], [learningData?.lessons]);
  const catalog = useMemo(() => [...new Map([...curated, ...(state?.generatedExercises || []), ...(learningData?.exercises || [])].map(item => [item.id, item])).values()], [state?.generatedExercises, learningData?.exercises]);
  const exercise = catalog.find(item => item.id === selectedId);
  const currentModule = allModules.find(item => item.id === exercise?.moduleId);
  useEffect(() => {
    const saved = restoredExerciseRef.current;
    if (saved && learningData?.exercises.some(item => item.id === saved)) { setSelectedId(saved); selectedIdRef.current = saved; appStorage.setItem(selectedKey, saved); restoredExerciseRef.current = null; }
  }, [learningData?.exercises]);
  const exerciseCurriculum = learningData?.curricula.find(item => item.lessonIds.includes(exercise?.moduleId || ''));
  const nextModules = exerciseCurriculum ? exerciseCurriculum.lessonIds.map(id => allModules.find(item => item.id === id)).filter((item): item is Module => !!item) : courseModules;
  const orderedIds = [...new Set([...(exerciseCurriculum?.source !== 'generated' ? diagnosticIds : []), ...nextModules.flatMap(item => item.exerciseIds), ...catalog.filter(item => nextModules.some(module => module.id === item.moduleId)).map(item => item.id)])];
  const nextId = orderedIds.slice(orderedIds.indexOf(selectedId) + 1).find(id => state?.progress[id]?.status !== 'completed');
  const nextExercise = catalog.find(item => item.id === nextId);
  const nextLesson = exerciseCurriculum?.source === 'generated'
    ? nextModules.slice(nextModules.findIndex(item => item.id === exercise?.moduleId) + 1).find(module => {
      const lesson = learningData?.lessons.find(item => item.id === module.id);
      return lesson?.status !== 'ready' || module.exerciseIds.some(id => state?.progress[id]?.status !== 'completed');
    }) : undefined;

  function select(id: string) {
    restoredExerciseRef.current = null;
    selectedIdRef.current = id;
    setSelectedId(id);
    appStorage.setItem(selectedKey, id);
  }
  return { state, setState, health, nativeAvailable, loadError, load, selectedId, selectedIdRef,
    allModules, catalog, exercise, currentModule, nextExercise, nextLesson, select };
}
export type Study = ReturnType<typeof useStudy>;
