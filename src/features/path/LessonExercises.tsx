import { ArrowRight, Plus } from 'lucide-react';
import type { AppState, Difficulty, Exercise } from '../../../shared/types';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import type { LearningPathController } from './useLearningPath';

export function LessonExercises({ path, state, catalog, selectExercise }: {
  path: LearningPathController; state: AppState; catalog: Exercise[]; selectExercise: (id: string) => void;
}) {
  const { selectedModule, generationBusy, generateExercise, generationDifficulty, setGenerationDifficulty } = path;
  if (!selectedModule) return null;
  return <><h2>Exercises</h2><div className="exercise-list">
    {catalog.filter(item => item.moduleId === selectedModule.id).map(item =>
      <Button variant="plain" key={item.id} onClick={() => selectExercise(item.id)}><strong>{item.title}</strong>
        <span>{state.progress[item.id]?.status === 'completed' ? 'Complete' : item.difficulty}</span><ArrowRight size={16} /></Button>)}
    <div className="add-exercise-row">
      <Button variant="plain" className="add-exercise-button" loading={generationBusy} disabled={generationBusy}
        onClick={() => void generateExercise(selectedModule.id, generationDifficulty)}><Plus size={15} />{generationBusy ? 'Adding exercise…' : 'Add exercise'}</Button>
      <Select compact value={generationDifficulty} onValueChange={value => setGenerationDifficulty(value as Difficulty)}
        disabled={generationBusy} aria-label="New exercise difficulty" options={[{ value: 'warmup', label: 'Warmup' }, { value: 'practice', label: 'Practice' }, { value: 'stretch', label: 'Stretch' }]} />
    </div>
  </div></>;
}
