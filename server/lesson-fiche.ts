import { z } from 'zod';
import type { StateStore } from './state.js';

export const ficheContentSchema = z.string().trim().min(1).max(20000);
export const ficheInstructions = `A fiche de révision is the learner's concise reference for what they should remember and be able to use after a lesson. Select the definitions, theorems, laws, relationships or essential methods worth recalling for this subject and level. Use your judgment about what belongs and how many entries it needs; there is no target entry count. Give each idea a clear label, precise content, and the conditions, notation or use case needed to apply it correctly. Use readable Markdown and LaTeX where appropriate. Keep proofs, derivations, extended examples and exercise answers in the lesson, and omit a duplicate section title. Preserve useful learner-requested distinctions when revising the fiche.`;

const updateSchema = z.object({ lessonId: z.string().min(1).max(120), revision: z.number().int().positive(), content: ficheContentSchema }).strict();
export const lessonFicheTool = {
  type: 'function' as const, name: 'update_lesson_fiche', strict: false,
  description: 'Create or revise the current lesson’s What to remember fiche when the learner asks to save, add, clarify, shorten or change its content. Supply the complete Markdown fiche and the lesson revision you received. Preserve unrelated entries. Confirm success only after the tool succeeds. On conflict, use the returned current lesson to reconsider the edit.',
  parameters: z.toJSONSchema(updateSchema) as Record<string, unknown>,
};

export async function updateLessonFiche(store: StateStore, raw: unknown, allowedLessonId: string) {
  const input = updateSchema.parse(raw);
  if (input.lessonId !== allowedLessonId) return { error: 'This conversation can only edit its own lesson’s fiche.' };
  return store.updateLearning(data => {
    const lesson = data.lessons.find(item => item.id === input.lessonId);
    if (!lesson || lesson.status !== 'ready') return { error: 'The lesson must be ready before editing its fiche.' };
    if (lesson.fiche === input.content) return { lesson };
    if (lesson.revision !== input.revision) return { error: 'The lesson changed. Review the current version before trying again.', lesson };
    lesson.fiche = input.content;
    lesson.revision++;
    return { lesson };
  });
}
