import { z } from 'zod';
import { reasoningEfforts } from '../shared/model-settings.js';

export const modelSelectionSchema = z.object({
  model: z.string().min(1).max(160).regex(/^[a-zA-Z0-9._-]+$/),
  reasoningEffort: z.enum(reasoningEfforts),
}).strict();
