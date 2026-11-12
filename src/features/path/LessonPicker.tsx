import { Check } from 'lucide-react';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
import type { LearningPathController } from './useLearningPath';

export function LessonPicker({ path }: { path: LearningPathController }) {
  const { pathModules, selectedModule, setSelectedModuleId, completedLessonIds } = path;
  if (!selectedModule) return null;
  return <SelectRoot value={selectedModule.id} onValueChange={id => { if (id) setSelectedModuleId(id); }}
    items={pathModules.map(lesson => ({ value: lesson.id, label: lesson.title }))}>
    <Tooltip><TooltipTrigger render={<SelectTrigger id="path-lesson" aria-label="Choose lesson" />}><SelectValue /></TooltipTrigger><TooltipContent>{selectedModule.title}</TooltipContent></Tooltip>
    <SelectContent className="lesson-picker-menu">
      {pathModules.map((lesson, index) => <SelectItem key={lesson.id} value={lesson.id}>
        <span className="lesson-option"><span>{lesson.title}</span><small>
          {path.activeCurriculum?.source === 'generated' ? `Lesson ${index + 1}` : `Phase ${lesson.phase} · ${lesson.subject}`}
          {'status' in lesson && lesson.status !== 'ready' && ` · ${lesson.status}`}
          {completedLessonIds.has(lesson.id) && <span className="module-complete"><Check size={11} aria-hidden="true" />Complete</span>}
        </small></span>
      </SelectItem>)}
    </SelectContent>
  </SelectRoot>;
}
