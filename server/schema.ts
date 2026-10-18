import { z } from 'zod';

const bounded = (max: number) => z.string().trim().max(max);
export const profileSchema = z.object({
  name: bounded(100), language: z.enum(['en', 'fr']),
  sessionMinutes: z.number().int().min(10).max(180),
  sessionsPerWeek: z.number().int().min(1).max(7), goal: bounded(1000),
}).strict();
export const progressSchema = z.object({
  exerciseId: bounded(120).min(1), status: z.enum(['started', 'completed']),
  confidence: z.number().int().min(0).max(5), updatedAt: z.iso.datetime(),
  hintCount: z.number().int().min(0).max(10000),
  lastScore: z.number().int().min(0).max(100).nullable(),
  nextReviewAt: z.iso.datetime().nullable(),
  notes: bounded(4000).optional(),
}).strict();
export const rubricSchema = z.object({ criterion: bounded(300).min(1), points: z.number().int().min(1).max(100) }).strict();
export const exerciseSchema = z.object({
  id: bounded(120).min(1), moduleId: bounded(120).min(1), title: bounded(200).min(1),
  difficulty: z.enum(['warmup', 'practice', 'stretch']), minutes: z.number().int().min(1).max(180),
  prompt: bounded(10000).min(1), starter: bounded(3000), skills: z.array(bounded(120)).min(1).max(12),
  hints: z.array(bounded(2000)).min(1).max(5), solution: bounded(12000).min(1), answer: bounded(3000).min(1),
  rubric: z.array(rubricSchema).min(1).max(8), generated: z.boolean().optional(),
}).strict();
export const tutorResponseSchema = z.object({
  kind: z.enum(['hint', 'feedback', 'clarify', 'explanation']), observation: bounded(3000),
  feedback: bounded(6000), nextStep: bounded(3000), question: bounded(2000),
  score: z.number().int().min(0).max(100).nullable(),
  criteria: z.array(z.object({ criterion: bounded(300), awarded: z.number().min(0).max(100), max: z.number().min(0).max(100), comment: bounded(1000) }).strict()).max(8),
  readable: z.boolean(), confidence: z.enum(['low', 'medium', 'high']),
}).strict();
const sessionSchema = z.object({
  id: bounded(120), createdAt: z.iso.datetime(), exerciseId: bounded(120), mode: z.enum(['chat', 'hint', 'check', 'explain', 'question']),
  requestText: bounded(4000), response: tutorResponseSchema, snapshotId: bounded(120).optional(),
  snapshotIds: z.array(bounded(120).min(1)).max(21).optional(),
}).strict();
export const lessonSessionSchema = z.object({
  id: z.uuid(), moduleId: bounded(120).min(1), createdAt: z.iso.datetime(),
  requestText: bounded(4000).min(1), response: tutorResponseSchema, language: z.enum(['en', 'fr']).optional(),
}).strict();
export const reflectionSchema = z.object({
  id: bounded(120), exerciseId: bounded(120), createdAt: z.iso.datetime(),
  confidence: z.number().int().min(1).max(5), notes: bounded(4000), snapshotId: bounded(120).optional(),
  snapshotIds: z.array(bounded(120).min(1)).max(21).optional(),
}).strict();
export const exercisePageSchema = z.object({
  id: bounded(120).min(1), exerciseId: bounded(120).min(1), createdAt: z.iso.datetime(), snapshotId: bounded(120).min(1),
}).strict();
export const dailyReviewSchema = z.object({
  id: bounded(120), date: z.iso.date(), timeZone: bounded(100), createdAt: z.iso.datetime(),
  evidenceFingerprint: bounded(120), summary: bounded(3000), strengths: z.array(bounded(500)).max(8),
  gaps: z.array(bounded(500)).max(8), nextSteps: z.array(bounded(500)).max(8),
  memories: z.array(bounded(500)).max(8), recommendedModuleIds: z.array(bounded(120)).max(12),
  pace: z.enum(['reinforce', 'continue', 'accelerate']),
  evidenceSessionIds: z.array(bounded(120)).max(1000), evidenceReflectionIds: z.array(bounded(120)).max(1000),
  evidenceLessonSessionIds: z.array(bounded(120)).max(1000).optional(),
}).strict();
export const reviewOutputSchema = dailyReviewSchema.omit({
  id: true, date: true, timeZone: true, createdAt: true, evidenceFingerprint: true,
  evidenceSessionIds: true, evidenceReflectionIds: true, evidenceLessonSessionIds: true,
});
const planSessionSchema = z.object({ title: bounded(200), moduleId: bounded(120), exerciseId: bounded(120), minutes: z.number().int().min(1).max(180) }).strict();
export const planSchema = z.object({ title: bounded(200), summary: bounded(3000), adjustment: bounded(3000),
  weeks: z.array(z.object({ week: z.number().int().min(1).max(52), focus: bounded(500), moduleIds: z.array(bounded(120)).max(20), sessions: z.array(planSessionSchema).max(14) }).strict()).min(1).max(8),
}).strict();
export const stateSchema = z.object({
  profile: profileSchema, progress: z.record(z.string(), progressSchema), sessions: z.array(sessionSchema).max(10000),
  generatedExercises: z.array(exerciseSchema).max(5000), plan: planSchema.nullable(),
  reflections: z.array(reflectionSchema).max(10000).default([]), dailyReviews: z.array(dailyReviewSchema).max(10000).default([]),
  exercisePages: z.array(exercisePageSchema).max(100000).default([]),
  lessonSessions: z.array(lessonSessionSchema).max(10000).default([]),
}).strict();

export const profilePatchSchema = profileSchema.partial().strict();
export const progressPatchSchema = progressSchema.partial().strict();
export const tutorRequestSchema = z.object({
  exerciseId: bounded(120).min(1), mode: z.enum(['chat', 'hint', 'check', 'explain', 'question']),
  image: z.string().max(7_000_000).optional(), message: bounded(4000).optional(),
  pageIds: z.array(bounded(120).min(1)).max(20).optional(),
  hintLevel: z.number().int().min(1).max(3).optional(), language: z.enum(['en', 'fr']).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: bounded(2000) }).strict()).max(12).optional(),
}).strict();
export const lessonChatRequestSchema = z.object({
  id: z.uuid(), moduleId: bounded(120).min(1), message: z.string().max(4000).trim().min(1),
  language: z.enum(['en', 'fr']).optional(),
}).strict();
export const reflectionRequestSchema = z.object({
  exerciseId: bounded(120).min(1), confidence: z.number().int().min(1).max(5), notes: bounded(4000),
  image: z.string().max(7_000_000).optional(), pageIds: z.array(bounded(120).min(1)).max(20).optional(),
}).strict();
export const pageRequestSchema = z.object({ image: z.string().max(7_000_000) }).strict();
export const dailyReviewRequestSchema = z.object({ date: z.iso.date(), timeZone: bounded(100).min(1) }).strict();
export const generateRequestSchema = z.object({ moduleId: bounded(120).min(1), difficulty: z.enum(['warmup', 'practice', 'stretch']) }).strict();

export function validateImage(value: string): string {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Image must be a JPEG, PNG, or WebP data URL.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5_000_000 || bytes.toString('base64') !== match[2]) throw new Error('Image is invalid or exceeds 5 MB.');
  const mime = match[1];
  const magicOk = mime === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!magicOk) throw new Error('Image data does not match its declared type.');
  return value;
}
