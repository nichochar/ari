import { z } from 'zod';
import { validateImage } from './schema.js';

const text = (max: number) => z.string().trim().min(1).max(max);
export const assessmentIdSchema = text(120);
const ids = z.array(assessmentIdSchema).max(100).refine(a => new Set(a).size === a.length);
const image = z.string().max(7_000_000).transform((value, ctx) => {
  try { return validateImage(value); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid photo.' }); return z.NEVER; }
});
export const assessmentCreateSchema = z.object({ id: assessmentIdSchema, curriculumId: assessmentIdSchema, minutes: z.number().int().min(5).max(180).optional() }).strict();
export const assessmentPatchSchema = z.object({ lessonIds: ids.min(1).optional(), minutes: z.number().int().min(5).max(180).optional(), instructions: z.string().max(6000).optional(), answer: z.string().max(40000).optional() }).strict();
export const assessmentPageSchema = z.object({ id: assessmentIdSchema, image }).strict();
export const assessmentChatSchema = z.object({ id: assessmentIdSchema, message: text(12000), image: image.optional(), answer: z.string().max(40000).optional() }).strict();
export const assessmentSubmitSchema = z.object({ id: assessmentIdSchema, image: image.optional(), answer: z.string().max(40000).optional() }).strict();
export const assessmentPlanSchema = z.object({ title: text(200), lessonIds: ids.min(1), minutes: z.number().int().min(5).max(180), scopeReason: text(4000) }).strict();
export const assessmentProblemSchema = z.object({ id: assessmentIdSchema, title: text(200), prompt: text(20000), lessonIds: ids.min(1), points: z.number().int().min(1).max(100), rubric: z.array(z.object({ criterion: text(2000), points: z.number().int().min(1).max(100) }).strict()).min(1).max(20), solution: text(30000) }).strict();
export const assessmentPaperSchema = z.object({ problems: z.array(assessmentProblemSchema).min(3).max(5) }).strict();
export const assessmentVerificationSchema = z.object({ valid: z.boolean(), reason: z.string().max(4000) }).strict();
export const assessmentChatOutputSchema = z.object({ content: text(20000), help: z.enum(['none', 'clarification', 'hint', 'solution']), problemIds: ids }).strict();
export const assessmentReviewSchema = z.object({ summary: text(6000), score: z.number().nonnegative().nullable(), maxScore: z.number().positive(), problems: z.array(z.object({ problemId: assessmentIdSchema, score: z.number().nonnegative().nullable(), maxScore: z.number().positive(), feedback: text(6000), criteria: z.array(z.object({ criterion: text(2000), awarded: z.number().nonnegative(), max: z.number().positive(), comment: z.string().max(3000) }).strict()).max(20) }).strict()).min(1).max(5), strengths: z.array(text(2000)).max(20), gaps: z.array(text(2000)).max(20), nextSteps: z.array(text(2000)).max(20), helpSummary: z.string().max(6000) }).strict();
export const assessmentGradeSchema = z.object({ review: assessmentReviewSchema, evidence: z.enum(['readable', 'unreadable', 'no_work']) }).strict();
const message = z.object({ id: text(150), role: z.enum(['user', 'assistant']), content: z.string().max(20000), createdAt: text(60), status: z.enum(['pending', 'complete', 'failed']), snapshotIds: ids, draftAnswer: z.string().max(40000).optional(), contextSnapshotIds: z.array(assessmentIdSchema).max(10000).optional(), help: z.enum(['none', 'clarification', 'hint', 'solution']), problemIds: ids, error: z.string().max(4000).optional(), requestHash: text(64).optional() }).strict();
const submission = z.object({ id: assessmentIdSchema, createdAt: text(60), snapshotIds: z.array(assessmentIdSchema).max(101).refine(a => new Set(a).size === a.length), answer: z.string().max(40000), messageIds: z.array(text(150)).max(10000), status: z.enum(['pending', 'complete', 'failed']), review: assessmentReviewSchema.optional(), error: z.string().max(4000).optional(), requestHash: text(64).optional() }).strict();
const assessment = z.object({ id: assessmentIdSchema, curriculumId: assessmentIdSchema, title: text(200), createdAt: text(60), updatedAt: text(60), status: z.enum(['planning', 'proposed', 'preparing', 'active', 'paused', 'grading', 'reviewed', 'failed']), lessonIds: ids, minutes: z.number().int().min(5).max(180), scopeReason: z.string().max(4000), instructions: z.string().max(6000), problems: z.array(assessmentProblemSchema).max(5), pages: z.array(z.object({ id: assessmentIdSchema, snapshotId: assessmentIdSchema, createdAt: text(60) }).strict()).max(100), answer: z.string().max(40000), messages: z.array(message).max(10000), submissions: z.array(submission).max(1000), error: z.string().max(4000).optional(), failureStage: z.enum(['plan', 'prepare', 'grade']).optional(), requestHash: text(64).optional() }).strict();
export const assessmentDataSchema = z.object({ assessments: z.array(assessment).max(10000) }).strict().superRefine((data, ctx) => {
  if (new Set(data.assessments.map(a => a.id)).size !== data.assessments.length) ctx.addIssue({ code: 'custom', message: 'Duplicate assessment identity.' });
  for (const a of data.assessments) {
    for (const entries of [a.pages, a.messages, a.submissions, a.problems]) if (new Set(entries.map(e => e.id)).size !== entries.length) ctx.addIssue({ code: 'custom', message: 'Duplicate assessment record identity.' });
    for (const s of a.submissions) if (s.messageIds.some(id => !a.messages.some(m => m.id === id))) ctx.addIssue({ code: 'custom', message: 'Submission conversation evidence is missing.' });
  }
});
