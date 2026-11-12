import { matchRoutes } from 'react-router';

export type View = 'desk' | 'path' | 'journal' | 'settings' | 'chat' | 'assessments';
export type LessonTab = 'lesson' | 'fiche' | 'exercises';
export const labels: Record<View, string> = {
  desk: 'Study desk', path: 'Learning path', journal: 'Journal', settings: 'Settings', chat: 'Talk with Ari', assessments: 'Assessments',
};
export const sectionPaths: Record<View, string> = {
  desk: '/study', path: '/learn', journal: '/journal', settings: '/settings', chat: '/chat', assessments: '/assessments',
};
const definitions = [
  { path: '/', view: undefined },
  { path: '/study/:exerciseId?', view: 'desk' },
  { path: '/learn/:curriculumId?', view: 'path' },
  { path: '/learn/:curriculumId/lessons/:lessonId', view: 'path' },
  { path: '/assessments/:assessmentId?', view: 'assessments' },
  { path: '/chat', view: 'chat' }, { path: '/journal', view: 'journal' }, { path: '/settings', view: 'settings' },
] satisfies { path: string; view: View | undefined }[];

export function readRoute(pathname: string, search = '') {
  const match = matchRoutes(definitions, pathname)?.at(-1);
  const query = new URLSearchParams(search);
  const tab = query.get('tab');
  return {
    found: !!match, home: pathname === '/', view: match?.route.view,
    curriculumId: match?.params.curriculumId, lessonId: match?.params.lessonId,
    exerciseId: match?.params.exerciseId, assessmentId: match?.params.assessmentId,
    tab: (tab === 'fiche' || tab === 'exercises' ? tab : 'lesson') as LessonTab,
    focusId: query.get('focus') || '',
    target: query.get(match?.route.view === 'journal' ? 'reflection' : 'message') || '',
  };
}
export type AppRoute = ReturnType<typeof readRoute>;

export const curriculumPath = (id: string) => '/learn/' + encodeURIComponent(id);
export const lessonPath = (curriculumId: string, lessonId: string, tab: LessonTab = 'lesson') =>
  curriculumPath(curriculumId) + '/lessons/' + encodeURIComponent(lessonId) + (tab === 'lesson' ? '' : '?tab=' + tab);
export const exercisePath = (id: string) => '/study/' + encodeURIComponent(id);
export const assessmentPath = (id: string) => '/assessments/' + encodeURIComponent(id);

export function withPreview(destination: string, search: string) {
  const preview = new URLSearchParams(search).get('onboardingPreview');
  if (!preview || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(preview)) return destination;
  const url = new URL(destination, 'http://ari.local');
  url.searchParams.set('onboardingPreview', preview.toLowerCase());
  return url.pathname + url.search + url.hash;
}

export function withoutPreview(pathname: string, search: string) {
  const query = new URLSearchParams(search);
  query.delete('onboardingPreview');
  return pathname + (query.size ? '?' + query : '');
}
