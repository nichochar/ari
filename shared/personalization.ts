export type PersonalizationActor = 'user' | 'ari' | 'external' | 'migration';

export interface PersonalizationDocument {
  path: string; content: string; hash: string; revision: number;
  updatedAt: string; actor: PersonalizationActor;
}
export interface PersonalizationRead extends PersonalizationDocument {
  offset: number; total: number; truncated: boolean;
}
export interface PersonalizationEntry extends Omit<PersonalizationDocument, 'content'> { characters: number; }
export interface OnboardingState {
  status: 'new' | 'imported' | 'complete' | 'skipped'; updatedAt: string; completedAt?: string;
}
export interface PersonalizationView {
  tutor: PersonalizationDocument; user: PersonalizationDocument;
  files: PersonalizationEntry[]; onboarding: OnboardingState;
}
export interface PersonalizationMutation {
  /** null creates a new file; an existing file requires its current hash. */
  expectedHash: string | null; actor: 'user' | 'ari'; reason?: string;
}
export interface OnboardingAnswers {
  name?: string; goals: string; startingLevel?: string; learningPreferences?: string;
  tutorStyle?: string; boundaries?: string; expectedUserHash: string; expectedTutorHash?: string;
}
export interface PersonalizationRevision extends PersonalizationDocument { reason?: string; deleted?: boolean; }
export interface PersonalizationMetadata {
  rootPath: string; workspaceId: string; migrated: boolean; onboarding: OnboardingState;
}
