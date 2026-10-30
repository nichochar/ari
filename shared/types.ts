export type Subject = string;
export type Difficulty = 'warmup' | 'practice' | 'stretch';
export type Language = 'en' | 'fr';
export interface Module {
  id: string; subject: Subject; title: string; frenchTitle: string; phase: number;
  summary: string; primer: string; objectives: string[]; prerequisites: string[];
  exerciseIds: string[]; resources: { title: string; url: string }[];
}
export interface Exercise {
  id: string; moduleId: string; title: string; difficulty: Difficulty; minutes: number;
  prompt: string; starter: string; skills: string[]; hints: string[];
  solution: string; answer: string; rubric: { criterion: string; points: number }[];
  generated?: boolean;
}
export interface Profile {
  name: string; language: Language; sessionMinutes: number; sessionsPerWeek: number; goal: string;
}
export interface Progress {
  exerciseId: string; status: 'started' | 'completed'; confidence: number;
  updatedAt: string; hintCount: number; lastScore: number | null; nextReviewAt: string | null;
  notes?: string;
}
export interface TutorResponse {
  kind: 'hint' | 'feedback' | 'clarify' | 'explanation';
  observation: string; feedback: string; nextStep: string; question: string;
  score: number | null; criteria: { criterion: string; awarded: number; max: number; comment: string }[];
  readable: boolean; confidence: 'low' | 'medium' | 'high';
}
export interface TutorRequest {
  id?: string; exerciseId: string; mode: 'chat' | 'hint' | 'check' | 'explain' | 'question';
  image?: string; pageIds?: string[]; message?: string; hintLevel?: number; language?: Language;
  history?: { role: 'user' | 'assistant'; content: string }[];
}
export interface Session {
  id: string; createdAt: string; exerciseId: string; mode: TutorRequest['mode'];
  requestText: string; response: TutorResponse; requestHash?: string;
  snapshotId?: string; snapshotIds?: string[];
}
export interface LessonChatRequest {
  id: string; moduleId: string; message: string; language?: Language;
}
export interface LessonSession {
  id: string; moduleId: string; createdAt: string; requestText: string; response: TutorResponse; language?: Language;
}
export interface Reflection {
  id: string; exerciseId: string; createdAt: string; confidence: number; notes: string;
  snapshotId?: string; snapshotIds?: string[];
}
export interface ExercisePage {
  id: string; exerciseId: string; createdAt: string; snapshotId: string;
}
export const MAX_EXERCISE_PAGES = 20;
export interface DailyReview {
  id: string; date: string; timeZone: string; createdAt: string; evidenceFingerprint: string;
  summary: string; strengths: string[]; gaps: string[]; nextSteps: string[]; memories: string[];
  recommendedModuleIds: string[]; pace: 'reinforce' | 'continue' | 'accelerate';
  evidenceSessionIds: string[]; evidenceReflectionIds: string[]; evidenceLessonSessionIds?: string[];
}
export interface ReflectionRequest {
  exerciseId: string; confidence: number; notes: string; image?: string; pageIds?: string[];
}
export interface ReflectionResponse { progress: Progress; reflection: Reflection; }
export interface ArchivedStudyPlan {
  title: string; summary: string; adjustment: string;
  weeks: { week: number; focus: string; moduleIds: string[];
    sessions: { title: string; moduleId: string; exerciseId: string; minutes: number }[] }[];
}
export interface AppState {
  profile: Profile; progress: Record<string, Progress>; sessions: Session[];
  generatedExercises: Exercise[]; plan: ArchivedStudyPlan | null;
  reflections: Reflection[]; dailyReviews: DailyReview[]; exercisePages: ExercisePage[]; lessonSessions: LessonSession[];
}
export interface Health { status: 'ok'; aiConfigured: boolean; model: string; }
