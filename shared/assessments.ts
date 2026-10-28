export type AssessmentStatus = 'planning' | 'proposed' | 'preparing' | 'active' | 'paused' | 'grading' | 'reviewed' | 'failed';
export type AssessmentHelp = 'none' | 'clarification' | 'hint' | 'solution';

export interface AssessmentProblem {
  id: string; title: string; prompt: string; lessonIds: string[]; points: number;
  rubric: { criterion: string; points: number }[]; solution: string;
}
export interface AssessmentMessage {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: string;
  status: 'pending' | 'complete' | 'failed'; snapshotIds: string[];
  draftAnswer?: string; contextSnapshotIds?: string[];
  help: AssessmentHelp; problemIds: string[]; error?: string; requestHash?: string;
}
export interface AssessmentReview {
  summary: string; score: number | null; maxScore: number;
  problems: { problemId: string; score: number | null; maxScore: number; feedback: string;
    criteria: { criterion: string; awarded: number; max: number; comment: string }[] }[];
  strengths: string[]; gaps: string[]; nextSteps: string[]; helpSummary: string;
}
export interface AssessmentSubmission {
  id: string; createdAt: string; snapshotIds: string[]; answer: string; messageIds: string[];
  status: 'pending' | 'complete' | 'failed'; review?: AssessmentReview; error?: string; requestHash?: string;
}
export interface Assessment {
  id: string; curriculumId: string; title: string; createdAt: string; updatedAt: string;
  status: AssessmentStatus; lessonIds: string[]; minutes: number; scopeReason: string; instructions: string;
  problems: AssessmentProblem[]; pages: { id: string; snapshotId: string; createdAt: string }[];
  answer: string; messages: AssessmentMessage[]; submissions: AssessmentSubmission[];
  error?: string; failureStage?: 'plan' | 'prepare' | 'grade'; requestHash?: string;
}
export interface AssessmentData { assessments: Assessment[]; }
export type AssessmentView = Omit<Assessment, 'problems' | 'requestHash'> & {
  problems: Omit<AssessmentProblem, 'solution' | 'rubric'>[];
};
export interface AssessmentSummary {
  id: string; curriculumId: string; title: string; status: AssessmentStatus; createdAt: string; updatedAt: string;
  minutes: number; problemCount: number; latestScore: number | null; latestMaxScore: number | null; error?: string;
}
export interface AssessmentListView {
  assessments: AssessmentSummary[]; provider: { configured: boolean; model: string };
}

// /api/assessments: GET list; POST {id,curriculumId,minutes?} proposes a scope (202).
// /:id: GET view; PATCH {lessonIds?,minutes?,instructions?,answer?} saves an editable draft.
// /:id/prepare POST {} (202); /pause, /resume POST {}; /retry POST {} (202).
// /:id/pages POST {id,image}; DELETE /:id/pages/:pageId.
// /:id/chat POST {id,message,image?} (202); /:id/messages/:messageId/retry POST {} retries saved evidence.
// /:id/submit POST {id,image?,answer?} (202), including the current camera photo when available.
// Responses to mutations return AssessmentView; polling GET /:id tracks background operations.
