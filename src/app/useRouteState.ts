import { useEffect } from 'react';
import type { Navigation } from './useNavigation';
import type { Study } from './useStudy';
import type { useLearning } from '../useLearning';
import { appStorage } from '../storage';
import { assessmentPath, exercisePath, lessonPath, readRoute, labels, sectionPaths, type AppRoute } from './routes';
import type { LearningView } from '../../shared/learning';
import type { Exercise } from '../../shared/types';

export function routeProblem(route: AppRoute, data: LearningView, exercises: Exercise[]) {
  if (!route.found) return 'Page not found';
  if (route.exerciseId && !exercises.some(item => item.id === route.exerciseId)) return 'Exercise not found';
  if (route.curriculumId) {
    const curriculum = data.curricula.find(item => item.id === route.curriculumId);
    if (!curriculum) return 'Curriculum not found';
    if (route.lessonId && !curriculum.lessonIds.includes(route.lessonId)) return 'Lesson not found in this curriculum';
  }
  return '';
}

export function useRouteState(navigation: Navigation, study: Study, learning: ReturnType<typeof useLearning>) {
  const { route, location, view } = navigation;
  const ready = !!study.state && !!learning.data;
  const problem = ready ? routeProblem(route, learning.data!, study.catalog) : '';
  useEffect(() => {
    if (!ready) return;
    if (route.home) {
      const onboarding = learning.data!.personalization?.onboarding;
      if (navigation.initialHome.current && onboarding?.status === 'new' && appStorage.getItem('ari:onboardingOpenedAt') !== onboarding.updatedAt) {
        appStorage.setItem('ari:onboardingOpenedAt', onboarding.updatedAt);
        navigation.go('/chat', true);
        return;
      }
      let destination = navigation.sectionHref(view);
      const saved = new URL(destination, 'http://ari.local');
      if (routeProblem(readRoute(saved.pathname, saved.search), learning.data!, study.catalog)) destination = sectionPaths[view];
      if (destination === '/learn') {
        const lessonId = appStorage.getItem('ari:selectedModuleId');
        const curriculum = learning.data!.curricula.find(item => item.lessonIds.includes(lessonId || ''));
        if (lessonId && curriculum) destination = lessonPath(curriculum.id, lessonId);
      }
      if (!appStorage.getItem('ari:route:' + view)) {
        if (destination === '/chat') {
          const focus = appStorage.getItem('ari:chatFocus');
          if (learning.data!.curricula.some(item => item.id === focus)) destination += '?focus=' + encodeURIComponent(focus!);
        } else if (destination === '/assessments') {
          try {
            const selected = JSON.parse(appStorage.getItem('ari:assessment:selected') || 'null');
            if (typeof selected === 'string' && selected) destination = assessmentPath(selected);
          } catch { /* An invalid saved selection opens the list. */ }
        }
      }
      navigation.go(destination, true);
    } else if (route.view === 'desk' && !route.exerciseId && study.exercise) {
      navigation.go(exercisePath(study.exercise.id), true);
    } else if (!problem) navigation.remember();
  }, [location.key, ready, problem, study.exercise?.id]);
  useEffect(() => {
    const lesson = learning.data?.lessons.find(item => item.id === route.lessonId);
    const curriculum = learning.data?.curricula.find(item => item.id === route.curriculumId);
    document.title = `${problem || lesson?.title || curriculum?.title || labels[view]} · Ari`;
  }, [view, route.lessonId, route.curriculumId, learning.data, problem]);
  return { ready: ready && !route.home && !(route.view === 'desk' && !route.exerciseId), problem };
}
