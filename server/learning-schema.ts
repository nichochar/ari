import { z } from 'zod';
import { exerciseSchema } from './schema.js';

const text = (max: number) => z.string().max(max);
const id = text(120).min(1);
const timestamp = z.iso.datetime();
const ids = z.array(id).max(10000);

export const curriculumSchema = z.object({
  id, learnerId: id, title: text(200).min(1), description: text(10000), topic: text(300).min(1),
  level: text(1000), goal: text(4000), lessonIds: ids, createdAt: timestamp, updatedAt: timestamp,
  source: z.enum(['original', 'generated']),
}).strict();
export const learningLessonSchema = z.object({
  id, subject: text(300).min(1), title: text(200).min(1), frenchTitle: text(200), phase: z.number().int().min(1).max(10000),
  summary: text(10000), primer: text(50000), objectives: z.array(text(1000)).max(30), prerequisites: ids,
  exerciseIds: ids, resources: z.array(z.object({ title: text(300), url: text(4000).url() }).strict()).max(100),
  curriculumId: id, status: z.enum(['planned', 'preparing', 'ready', 'failed']), revision: z.number().int().min(1),
  error: text(4000).optional(),
}).strict();
export const learningProposalSchema = z.object({
  id, title: text(200).min(1), description: text(10000), topic: text(300).min(1), level: text(1000), goal: text(4000),
  kind: z.enum(['curriculum', 'expand']), targetCurriculumId: id.optional(), targetLessonId: id.optional(),
  expansion: z.enum(['enrich', 'followup']).optional(),
  lessons: z.array(z.object({ title: text(200).min(1), summary: text(10000), objectives: z.array(text(1000)).max(30) }).strict()).min(1).max(100),
  status: z.enum(['proposed', 'accepted', 'dismissed']), createdAt: timestamp, curriculumId: id.optional(),
  revision: z.number().int().min(1), materialIds: z.array(id).max(20).optional(),
  sourceUrls: z.array(text(4000).url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Sources must use HTTP or HTTPS.')).max(30).optional(),
}).strict();
export const mainMessageSchema = z.object({
  id, role: z.enum(['user', 'assistant']), content: text(100000), createdAt: timestamp,
  status: z.enum(['pending', 'streaming', 'complete', 'failed']), error: text(4000).optional(),
  runId: id.optional(), proposalIds: ids.optional(), materialIds: ids.optional(), curriculumId: id.optional(),
  proactive: z.boolean().optional(), deliveredAt: timestamp.optional(), readAt: timestamp.optional(),
}).strict();
export const learnerMemorySchema = z.object({
  content: text(30000), revision: z.number().int().min(1), updatedAt: timestamp, updatedBy: z.enum(['user', 'ari']),
}).strict();
export const materialSchema = z.object({
  id, title: text(300).min(1), kind: z.enum(['note', 'link', 'pdf']), createdAt: timestamp,
  url: text(4000).url().optional(), text: text(2_000_000), filename: text(300).optional(),
  sourceData: text(7_000_000).regex(/^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
}).strict();
export const learningRunSchema = z.object({
  id, requestId: id, status: z.enum(['queued', 'running', 'complete', 'failed']),
  kind: z.enum(['chat', 'prepare', 'review']), createdAt: timestamp, updatedAt: timestamp,
  messageId: id.optional(), assistantMessageId: id.optional(), lessonId: id.optional(), proposalId: id.optional(), error: text(4000).optional(),
  context: z.array(z.unknown()).max(100000).optional(), contextTokens: z.number().int().min(0).optional(), completedText: text(100000).optional(),
  baseContextHash: text(128).optional(),
}).strict();
export const learningEventSchema = z.object({
  id, runId: id, type: z.enum(['tool_call', 'tool_result', 'text', 'compaction']), createdAt: timestamp,
  name: text(300).optional(), callId: id.optional(), data: z.unknown(),
}).strict();

// Unknown provider items must survive without Zod stripping future API fields. Reject
// values JSON cannot preserve and bound the complete document before it reaches SQL.
function validateJson(value: unknown, ctx: z.RefinementCtx): void {
  try {
    const data = value as { context: unknown[]; events: { data: unknown }[]; runs: { context?: unknown[] }[] };
    JSON.stringify([data.context, ...data.events.map(event => event.data), ...data.runs.filter(run => run.context).map(run => run.context)], (_key, item: unknown) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint' ||
          (typeof item === 'number' && !Number.isFinite(item))) throw new Error('non-JSON value');
      return item;
    });
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, 'utf8') > 64_000_000) throw new Error('exceeds 64 MB');
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: `Learning data must be lossless JSON under 64 MB: ${String(error)}` });
  }
}

export const learningDataSchema = z.object({
  learnerId: id, curricula: z.array(curriculumSchema).max(1000), lessons: z.array(learningLessonSchema).max(10000),
  exercises: z.array(exerciseSchema).max(50000), messages: z.array(mainMessageSchema).max(100000),
  proposals: z.array(learningProposalSchema).max(10000), memory: learnerMemorySchema,
  materials: z.array(materialSchema).max(10000), runs: z.array(learningRunSchema).max(100000),
  events: z.array(learningEventSchema).max(200000).default([]),
  context: z.array(z.unknown()).max(100000), contextTokens: z.number().int().min(0), compactedAt: timestamp.optional(),
  reviewedEvidenceIds: z.array(id).max(100000),
}).strict().superRefine((data, ctx) => {
  validateJson(data, ctx);
  for (const collection of ['curricula', 'lessons', 'exercises', 'messages', 'proposals', 'materials', 'runs', 'events'] as const) {
    const seen = new Set<string>();
    data[collection].forEach((item, index) => {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', path: [collection, index, 'id'], message: 'Duplicate record ID.' });
      seen.add(item.id);
    });
  }
  const curricula = new Map(data.curricula.map(curriculum => [curriculum.id, curriculum]));
  const lessons = new Map(data.lessons.map(lesson => [lesson.id, lesson]));
  const exercises = new Map(data.exercises.map(exercise => [exercise.id, exercise]));
  data.curricula.forEach((curriculum, index) => {
    if (curriculum.learnerId !== data.learnerId) ctx.addIssue({ code: 'custom', path: ['curricula', index, 'learnerId'], message: 'Curriculum belongs to a different learner.' });
    if (new Set(curriculum.lessonIds).size !== curriculum.lessonIds.length || curriculum.lessonIds.some(id => lessons.get(id)?.curriculumId !== curriculum.id)) {
      ctx.addIssue({ code: 'custom', path: ['curricula', index, 'lessonIds'], message: 'Curriculum must reference its own unique lessons.' });
    }
  });
  data.lessons.forEach((lesson, index) => {
    if (!curricula.get(lesson.curriculumId)?.lessonIds.includes(lesson.id)) {
      ctx.addIssue({ code: 'custom', path: ['lessons', index, 'curriculumId'], message: 'Lesson must belong to an existing curriculum outline.' });
    }
    if (lesson.prerequisites.some(id => id === lesson.id || lessons.get(id)?.curriculumId !== lesson.curriculumId)) {
      ctx.addIssue({ code: 'custom', path: ['lessons', index, 'prerequisites'], message: 'Prerequisites must be other lessons in this curriculum.' });
    }
    if (new Set(lesson.exerciseIds).size !== lesson.exerciseIds.length || lesson.exerciseIds.some(id => exercises.get(id)?.moduleId !== lesson.id)) {
      ctx.addIssue({ code: 'custom', path: ['lessons', index, 'exerciseIds'], message: 'Lesson must reference its own unique exercises.' });
    }
  });
  data.exercises.forEach((exercise, index) => {
    if (!lessons.get(exercise.moduleId)?.exerciseIds.includes(exercise.id)) {
      ctx.addIssue({ code: 'custom', path: ['exercises', index, 'moduleId'], message: 'Exercise must belong to an existing lesson.' });
    }
  });
});

export const mainChatRequestSchema = z.object({
  id: z.uuid(), message: z.string().trim().min(1).max(12000), curriculumId: id.optional(),
  materialIds: z.array(id).max(20).optional(),
}).strict();
export const memoryPatchSchema = z.object({ content: text(30000), revision: z.number().int().min(1) }).strict();

export const personalizationWriteSchema = z.object({
  path: text(300).min(1), content: text(64000), expectedHash: text(128).nullable(), reason: text(1000).optional(),
}).strict();
export const personalizationRestoreSchema = z.object({
  path: text(300).min(1), revision: z.number().int().min(1), expectedHash: text(128).nullable(),
}).strict();
export const onboardingCompleteSchema = z.object({
  name: text(200).optional(), goals: text(3000).min(1).optional(), startingLevel: text(3000).optional(),
  learningPreferences: text(3000).optional(), tutorStyle: text(3000).optional(), boundaries: text(3000).optional(),
  expectedUserHash: text(128).optional(), expectedTutorHash: text(128).optional(),
}).strict();
