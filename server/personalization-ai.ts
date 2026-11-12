import { aiSchemas, type AIAsk } from './ai.js';
import type { LearningAgentProvider } from './learning-provider.js';
import { PersonalizationWorkspace } from './personalization.js';
import { executeWorkspaceTool, personalizationInstructions, workspaceTools } from './personalization-tools.js';
import { z } from 'zod';
import type { StateStore } from './state.js';
import { lessonFicheTool, updateLessonFiche } from './lesson-fiche.js';

const lessonContext = z.object({ lesson: z.object({ id: z.string(), revision: z.number().int().positive() }) });

/** Keep the existing task provider; interactive tutors additionally get scoped file tools. */
export function createPersonalizedAsk(base: AIAsk | undefined, tutor: LearningAgentProvider | undefined,
  workspace: PersonalizationWorkspace, onMutation?: () => Promise<void>, store?: StateStore): AIAsk | undefined {
  if (!base) return undefined;
  let active = 0;
  return async (task, instructions, payload, image) => {
    const currentInstructions = async () => `${instructions}\n\n${await personalizationInstructions(workspace)}`;
    if (task !== 'tutor' || !tutor) return base(task, await currentInstructions(), payload, image);
    const lessonId = store ? lessonContext.safeParse(payload).data?.lesson.id : undefined;
    if (active >= 2) throw new Error('AI_BUSY');
    active++;
    try {
      const content: unknown[] = [{ type: 'input_text', text: JSON.stringify(payload) }];
      for (const url of typeof image === 'string' ? [image] : image ?? [])
        content.push({ type: 'input_image', image_url: url, detail: 'high' });
      const result = await tutor.run({
        instructions: await currentInstructions(), refreshInstructions: currentInstructions,
        input: [{ role: 'user', content }], tools: lessonId ? [...workspaceTools, lessonFicheTool] : workspaceTools,
        ephemeral: true, outputSchema: aiSchemas.tutor,
        executeTool: async (name, args) => {
          try {
            if (name === lessonFicheTool.name && lessonId && store) {
              const result = await updateLessonFiche(store, args, lessonId);
              if (!result.error) await onMutation?.();
              return result;
            }
            const result = await executeWorkspaceTool(workspace, name, args);
            if (['workspace_write', 'workspace_edit', 'workspace_move', 'workspace_delete'].includes(name)) await onMutation?.();
            return result;
          } catch (error) {
            // Return recoverable conflicts/validation failures so the tutor can reread and retry.
            return { error: error instanceof Error && 'code' in error ? String(error.code) : 'invalid_tool_request',
              message: name === lessonFicheTool.name ? 'The fiche edit failed. Check the lesson id, revision and content before retrying.' : 'The file operation failed. Check the path and arguments; reread the latest file before editing.' };
          }
        },
      });
      return JSON.parse(result.text);
    } finally { active--; }
  };
}
