import type { Exercise, Module } from './types.js';
import type { PersonalizationView } from './personalization.js';

export interface Curriculum {
  id: string; learnerId: string; title: string; description: string; topic: string;
  level: string; goal: string; lessonIds: string[]; createdAt: string; updatedAt: string;
  source: 'original' | 'generated';
}
export interface LearningLesson extends Module {
  curriculumId: string; status: 'planned' | 'preparing' | 'ready' | 'failed';
  revision: number; error?: string;
}
export interface OutlineLesson { title: string; summary: string; objectives: string[]; }
export interface LearningProposal {
  id: string; title: string; description: string; topic: string; level: string; goal: string;
  kind: 'curriculum' | 'expand'; targetCurriculumId?: string; targetLessonId?: string;
  expansion?: 'enrich' | 'followup'; lessons: OutlineLesson[];
  status: 'proposed' | 'accepted' | 'dismissed'; createdAt: string; curriculumId?: string;
  revision: number; materialIds?: string[]; sourceUrls?: string[];
}
export interface MainMessage {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: string;
  status: 'pending' | 'streaming' | 'complete' | 'failed'; error?: string;
  runId?: string; proposalIds?: string[]; materialIds?: string[]; curriculumId?: string;
  proactive?: boolean; deliveredAt?: string; readAt?: string;
}
export interface LearnerMemory {
  content: string; revision: number; updatedAt: string; updatedBy: 'user' | 'ari';
}
export interface LearningMaterial {
  id: string; title: string; kind: 'note' | 'link' | 'pdf'; createdAt: string;
  url?: string; text: string; filename?: string; sourceData?: string;
}
export interface LearningRun {
  id: string; requestId: string; status: 'queued' | 'running' | 'complete' | 'failed';
  kind: 'chat' | 'prepare' | 'review'; createdAt: string; updatedAt: string;
  messageId?: string; assistantMessageId?: string; lessonId?: string; proposalId?: string; error?: string;
  context?: unknown[]; contextTokens?: number; completedText?: string; baseContextHash?: string;
}
export interface LearningEvent {
  id: string; runId: string; type: 'tool_call' | 'tool_result' | 'text' | 'compaction'; createdAt: string;
  name?: string; callId?: string; data: unknown;
}
export interface LearningData {
  learnerId: string; curricula: Curriculum[]; lessons: LearningLesson[]; exercises: Exercise[];
  messages: MainMessage[]; proposals: LearningProposal[]; memory: LearnerMemory;
  materials: LearningMaterial[]; runs: LearningRun[]; events: LearningEvent[];
  context: unknown[]; contextTokens: number; compactedAt?: string;
  reviewedEvidenceIds: string[];
}
export interface LearningView {
  personalization: PersonalizationView;
  curricula: Curriculum[]; lessons: LearningLesson[]; exercises: Exercise[];
  messages: MainMessage[]; proposals: LearningProposal[];
  /** Compatibility projection of current USER.md, never the archived memory blob. */
  memory: LearnerMemory;
  materials: Omit<LearningMaterial, 'text' | 'sourceData'>[]; runs: Omit<LearningRun, 'context' | 'contextTokens' | 'completedText'>[];
  events: Omit<LearningEvent, 'data'>[];
  unreadCount: number; provider: { configured: boolean; model: string; };
}
export interface MainChatRequest { id: string; message: string; curriculumId?: string; materialIds?: string[]; }

// POST /api/learning/chat returns {runId}; GET /api/learning returns LearningView.
// GET /api/learning/events provides SSE notifications; clients refetch on change.
// POST /api/learning/proposals/:id/accept {revision}; /dismiss {revision}.
// POST /api/learning/lessons/:id/prepare {}; POST /api/learning/read {}.
// PATCH /api/learning/memory {content,revision}; POST /api/learning/materials
// {title,kind:'note'|'link'|'pdf',text?,url?,data?,filename?}.
// POST /api/learning/idle {} delivers pending background messages between exercises.
