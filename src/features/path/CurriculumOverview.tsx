import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import type { LearningView } from '../../../shared/learning';
import { curriculumPath, lessonPath } from '../../app/routes';
import { appStorage } from '../../storage';
import { AppLink } from '../../components/app-link';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import type { LearningPathController } from './useLearningPath';

export function CurriculumOverview({ data, path, curriculumId, explore }: {
  data: LearningView; path: LearningPathController; curriculumId?: string; explore: () => void;
}) {
  const curriculum = data.curricula.find(item => item.id === curriculumId);
  const lastLessonId = curriculum && appStorage.getItem('ari:lastLesson:' + curriculum.id);
  const lastLesson = path.pathModules.find(item => item.id === lastLessonId);
  return <section className="page">
    <PageHeader title={curriculum?.title || 'Learning path'} actions={curriculum
      ? <AppLink to="/learn" variant="ghost" size="sm"><ArrowLeft size={15} />All curricula</AppLink>
      : <Button variant="ghost" size="sm" onClick={explore}><Plus size={15} />Explore a new subject</Button>} />
    {curriculum ? <>
      {lastLesson && <div className="curriculum-continue"><AppLink to={lessonPath(curriculum.id, lastLesson.id)} variant="outline">Continue learning <ArrowRight size={16} /></AppLink></div>}
      <Card className="curriculum-lessons">{path.pathModules.map((lesson, index) => <AppLink className="curriculum-lesson" key={lesson.id} to={lessonPath(curriculum.id, lesson.id)}>
        <span className="curriculum-lesson-number">{index + 1}</span>
        <span className="curriculum-lesson-copy"><strong>{lesson.title}</strong><small>{curriculum.source === 'original' ? `Phase ${lesson.phase} · ${lesson.subject}` : lesson.summary}</small></span>
        {path.completedLessonIds.has(lesson.id) ? <span className="module-complete"><Check size={13} />Complete</span>
          : 'status' in lesson && lesson.status !== 'ready' && <span className="curriculum-lesson-status">{lesson.status === 'preparing' ? 'Preparing' : lesson.status === 'failed' ? 'Needs attention' : 'Planned'}</span>}
        <ArrowRight size={16} />
      </AppLink>)}</Card>
    </> : <div className="curricula-grid">{data.curricula.map(item => {
      const completed = item.lessonIds.filter(id => path.completedLessonIds.has(id)).length;
      return <Card key={item.id} className="curriculum-card"><AppLink to={curriculumPath(item.id)} className="curriculum-card-link">
        <h2>{item.title}</h2>
        <span className="curriculum-card-progress">{completed} / {item.lessonIds.length} lessons completed <ArrowRight size={17} /></span>
      </AppLink></Card>;
    })}</div>}
  </section>;
}
