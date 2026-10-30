import express, { type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ZodError, z } from 'zod';
import { modules, exercises } from '../shared/curriculum.js';
import { MAX_EXERCISE_PAGES, type AppState, type DailyReview, type Exercise, type LessonSession, type Module, type Progress, type Session, type TutorRequest, type TutorResponse } from '../shared/types.js';
import { generateInstructions, lessonInstructions, normalizeGeneratedMath, reviewInstructions, tutorInstructions, verifyInstructions, type AIAsk } from './ai.js';
import { dailyReviewRequestSchema, exerciseSchema, generateRequestSchema, lessonChatRequestSchema, pageRequestSchema, profilePatchSchema, progressPatchSchema, reflectionRequestSchema, reviewOutputSchema, tutorRequestSchema, tutorResponseSchema, validateImage } from './schema.js';
import { StateStore } from './state.js';
import { cameraBridge } from './camera.js';
import { LearningService } from './learning-service.js';
import { learningRoutes } from './learning-routes.js';
import { AssessmentService } from './assessment-service.js';
import { assessmentRoutes } from './assessment-routes.js';
import { LearningProviderError, type LearningAgentProvider } from './learning-provider.js';
import { PersonalizationError, PersonalizationWorkspace } from './personalization.js';
import { createPersonalizedAsk } from './personalization-ai.js';
import { profileDefaults } from './personalization-tools.js';

const curatedExercises = exercises as Exercise[];
const curriculumModules = modules as Module[];
const moduleMap = new Map(curriculumModules.map(module => [module.id, module]));
const curatedMap = new Map(curatedExercises.map(exercise => [exercise.id, exercise]));

type AppOptions = { learningProvider?: LearningAgentProvider; personalizationProvider?: LearningAgentProvider; learningConfigured?: boolean; dbPath?: string; legacyStatePath?: string; ai?: AIAsk; aiConfigured?: boolean; model?: string; distPath?: string; workspacePath?: string };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const body = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Invalid request: ' + parsed.error.issues.map(issue => issue.path.join('.') || 'body').join(', '));
  return parsed.data;
};
const findExercise = (state: AppState, id: string) => curatedMap.get(id) ?? state.generatedExercises.find(exercise => exercise.id === id);
const defaultProgress = (exerciseId: string): Progress => ({ exerciseId, status: 'started', confidence: 0,
  updatedAt: new Date().toISOString(), hintCount: 0, lastScore: null, nextReviewAt: null });
const failAI = (error: unknown): never => {
  if (error instanceof LearningProviderError) {
    if (error.code === 'CODEX_INPUT_TOO_LARGE') throw new HttpError(400, error.message);
    if (error.code === 'CODEX_LIMIT') throw new HttpError(503, 'Codex usage limit reached. Try again when it resets or configure OpenAI API credits.');
    if (error.code === 'CODEX_RATE_LIMIT' || error.code === 'API_RATE_LIMIT' || error.code === 'CODEX_BUSY') throw new HttpError(429, 'The tutor is temporarily rate limited or busy. Try again shortly.');
    if (error.code === 'CODEX_TIMEOUT' || error.code === 'API_TIMEOUT') throw new HttpError(504, 'The tutor timed out. Try again.');
    if (error.code === 'CODEX_AUTH' || error.code === 'CODEX_UNAVAILABLE') throw new HttpError(503, 'Codex tutoring is unavailable. Check Codex sign-in and local installation.');
    if (error.code === 'CODEX_MODEL') throw new HttpError(503, 'The configured Codex model is unavailable. Check CODEX_TUTOR_MODEL and CODEX_MODEL.');
    if (error.code === 'CODEX_UPGRADE') throw new HttpError(503, 'This model needs a newer Codex CLI. Update the local adapter configured by CODEX_BIN.');
    if (error.code === 'API_AUTH') throw new HttpError(503, 'The AI service is not authorized. Check server credentials.');
    if (error.code === 'API_CREDITS') throw new HttpError(503, 'OpenAI credits are exhausted. Add credits or configure another tutor provider.');
  }
  if (error instanceof Error && error.message === 'AI_BUSY') throw new HttpError(429, 'The tutor is busy. Try again shortly.');
  if (error instanceof Error) {
    if (error.message === 'AI_CODEX_LIMIT') throw new HttpError(503, 'Codex usage limit reached. Try again when it resets or configure OpenAI API credits.');
    if (error.message === 'AI_CODEX_UPGRADE') throw new HttpError(503, 'This model needs a newer Codex CLI. Update the local adapter configured by CODEX_BIN.');
    if (error.message === 'AI_CODEX_MODEL') throw new HttpError(503, 'The configured Codex model is unavailable. Check CODEX_TUTOR_MODEL and CODEX_MODEL.');
    if (error.message === 'AI_CODEX_AUTH' || error.message === 'AI_CODEX_UNAVAILABLE') throw new HttpError(503, 'Codex tutoring is unavailable. Check Codex sign-in and local installation.');
    if (error.message === 'AI_TIMEOUT') throw new HttpError(504, 'The tutor timed out. Try again.');
  }
  const e = error as { status?: number; code?: string; error?: { code?: string } };
  if (e?.code === 'credit_balance_exhausted' || e?.code === 'insufficient_quota' || e?.error?.code === 'insufficient_quota' || e?.error?.code === 'credit_balance_exhausted')
    throw new HttpError(503, 'OpenAI credits are exhausted. Add credits or configure another tutor provider.');
  if (e?.status === 429) throw new HttpError(429, 'The AI service is rate limited. Try again shortly.');
  if (e?.status === 401 || e?.status === 403) throw new HttpError(503, 'The AI service is not authorized. Check server credentials.');
  throw new HttpError(502, 'The AI service could not complete this request. Try again.');
};
const safeAI = async (ai: AIAsk, ...args: Parameters<AIAsk>) => { try { return await ai(...args); } catch (error) { return failAI(error); } };

function normalizeTutor(value: unknown, mode: TutorRequest['mode'], exercise: Exercise, hasWork: boolean, language: 'en' | 'fr'): TutorResponse {
  const rawSchema = tutorResponseSchema.extend({ workRelevant: z.boolean(), workLegible: z.boolean(), assessmentRequested: z.boolean().optional() });
  const parsed = rawSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(502, 'The tutor returned an invalid response. Try again.');
  const { workRelevant, workLegible, assessmentRequested: _assessment, ...response } = parsed.data;
  if (mode === 'hint') return { ...response, kind: 'hint', score: null, criteria: [] };
  if (mode === 'explain' || mode === 'question') return { ...response, kind: 'explanation', score: null, criteria: [] };
  // Only the explicit Grade my work action may produce a score, regardless of model intent.
  if (mode !== 'check')
    return { ...response, kind: response.kind === 'feedback' ? 'explanation' : response.kind, score: null, criteria: [] };
  const rubric = exercise.rubric;
  const matched = response.criteria.length === rubric.length && rubric.every(r => {
    const item = response.criteria.find(c => c.criterion === r.criterion);
    return item && item.max === r.points && item.awarded >= 0 && item.awarded <= r.points;
  });
  if (!hasWork || !response.readable || !workRelevant || !workLegible || !response.observation.trim() || !matched) {
    const french = language === 'fr';
    return { ...response, kind: 'clarify', readable: false, score: null, criteria: [], confidence: 'low',
      feedback: french ? 'Je ne peux pas évaluer ce travail de façon fiable pour le moment.' : 'I cannot grade this work reliably yet.',
      nextStep: french ? 'Montrez une étape lisible de votre travail ou saisissez-la.' : 'Show one readable step of your work or type it out.',
      question: french ? 'Pouvez-vous partager une vue plus nette de votre démarche ?' : 'Could you share a clearer view of your working?' };
  }
  const total = rubric.reduce((sum, r) => sum + r.points, 0);
  const awarded = response.criteria.reduce((sum, c) => sum + c.awarded, 0);
  return { ...response, kind: 'feedback', score: Math.round(100 * awarded / total), criteria: response.criteria };
}

function normalizeLesson(value: unknown): TutorResponse {
  const parsed = tutorResponseSchema.extend({ workRelevant: z.boolean(), workLegible: z.boolean(), assessmentRequested: z.boolean().optional() }).safeParse(value);
  if (!parsed.success || !parsed.data.feedback.trim()) throw new HttpError(502, 'The tutor returned an invalid response. Try again.');
  const { workRelevant: _relevant, workLegible: _legible, assessmentRequested: _assessment, ...response } = parsed.data;
  return { ...response, kind: response.kind === 'feedback' ? 'explanation' : response.kind,
    observation: '', score: null, criteria: [], readable: false };
}

function lessonHistory(state: AppState, moduleId: string) {
  return state.lessonSessions.filter(session => session.moduleId === moduleId).slice(-8).flatMap(session => [
    { role: 'user' as const, content: session.requestText },
    { role: 'assistant' as const, content: [session.response.feedback, session.response.nextStep, session.response.question].filter(Boolean).join('\n').slice(0, 2000) },
  ]);
}

function storedHistory(state: AppState, exerciseId: string) {
  return state.sessions.filter(session => session.exerciseId === exerciseId).slice(-8).flatMap(session => [
    { role: 'user' as const, content: [session.requestText,
      (session.snapshotIds?.length ?? (session.snapshotId ? 1 : 0)) > 0
        ? `[Submitted ${session.snapshotIds?.length ?? 1} photo(s) of work]` : '',
    ].filter(Boolean).join('\n') || `[Asked for ${session.mode}]` },
    { role: 'assistant' as const, content: [
      session.response.observation && `Observation: ${session.response.observation}`,
      session.response.feedback,
      session.response.score !== null && `Score: ${session.response.score}%`,
      ...session.response.criteria.map(item => `${item.criterion}: ${item.awarded}/${item.max}. ${item.comment}`),
      session.response.nextStep && `Next step: ${session.response.nextStep}`,
      session.response.question,
    ].filter(Boolean).join('\n').slice(0, 2000) },
  ]);
}

function submittedImages(store: StateStore, state: AppState, exerciseId: string, pageIds: string[] | undefined, currentImage: string | undefined) {
  const ids = pageIds ?? [];
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Each saved page may be selected only once.');
  if (ids.length > MAX_EXERCISE_PAGES) throw new HttpError(400, `Select at most ${MAX_EXERCISE_PAGES} saved pages.`);
  const pages = ids.map(id => {
    const page = state.exercisePages.find(item => item.id === id && item.exerciseId === exerciseId);
    if (!page) throw new HttpError(400, 'A selected page is missing or belongs to another exercise.');
    return page;
  });
  const images: string[] = [];
  const snapshotIds: string[] = [];
  const imageOrder: { position: number; source: 'saved page' | 'current photo'; description: string; pageId?: string }[] = [];
  let totalBytes = 0;
  for (const page of pages) {
    const snapshot = store.getSnapshot(page.snapshotId);
    if (!snapshot) throw new HttpError(409, 'A saved page photo is unavailable.');
    totalBytes += snapshot.data.length;
    images.push(`data:${snapshot.mimeType};base64,${snapshot.data.toString('base64')}`);
    snapshotIds.push(page.snapshotId);
    imageOrder.push({ position: images.length, source: 'saved page', description: `Saved page ${images.length} for this exercise.`, pageId: page.id });
  }
  if (currentImage !== undefined) {
    try { validateImage(currentImage); } catch (error) { throw new HttpError(400, (error as Error).message); }
    totalBytes += Buffer.from(currentImage.split(',')[1], 'base64').length;
    images.push(currentImage);
    imageOrder.push({ position: images.length, source: 'current photo',
      description: 'Fresh current photo. It may overlap a saved page; count visible work only once.' });
  }
  if (totalBytes > 25_000_000) throw new HttpError(400, 'Selected photos exceed 25 MB combined. Remove some pages.');
  return { images, snapshotIds, imageOrder };
}

function onLocalDate(timestamp: string, date: string, timeZone: string): boolean {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timestamp)) === date;
}

function reviewEvidence(state: AppState, date: string, timeZone: string) {
  const sessions = state.sessions.filter(item => onLocalDate(item.createdAt, date, timeZone));
  const reflections = state.reflections.filter(item => onLocalDate(item.createdAt, date, timeZone));
  const lessonSessions = state.lessonSessions.filter(item => onLocalDate(item.createdAt, date, timeZone));
  const progress = Object.values(state.progress).filter(item => onLocalDate(item.updatedAt, date, timeZone));
  const evidenceFingerprint = createHash('sha256').update(JSON.stringify({ profile: state.profile, sessions, reflections, progress, ...(lessonSessions.length ? { lessonSessions } : {}) })).digest('hex');
  return { sessions, lessonSessions, reflections, progress, evidenceFingerprint };
}

export function createApp(options: AppOptions = {}) {
  if ('statePath' in options) throw new Error('Use dbPath for SQLite state; statePath is no longer supported.');
  const app = express();
  const store = new StateStore(options.dbPath ?? process.env.ARI_DB_PATH ?? join(process.cwd(), '.local', 'ari.sqlite'),
    { legacyPath: options.legacyStatePath ?? process.env.ARI_LEGACY_PATH ?? join(process.cwd(), '.local', 'state.json') });
  app.locals.store = store;
  const workspacePath = resolve(options.workspacePath ?? (options.dbPath ? `${options.dbPath}.workspace` : process.env.ARI_WORKSPACE_PATH ?? join(homedir(), '.ari', 'workspace')));
  const workspace = new PersonalizationWorkspace(store, workspacePath);
  app.locals.workspace = workspace;
  const learning = new LearningService(store, options.learningConfigured === false ? null : options.learningProvider, workspace);
  app.locals.learning = learning;
  const assessments = new AssessmentService(store, learning);
  app.locals.assessments = assessments;
  assessments.onReviewed = (assessmentId, submissionId) => learning.reviewAssessment(assessmentId, submissionId);
  void assessments.recover().catch(() => undefined);
  if (options.learningConfigured !== false) void learning.recover().catch(() => undefined);
  const catalogState = async (): Promise<AppState> => {
    const state = await store.read(), data = await store.readLearning();
    const existing = new Set([...curatedExercises, ...state.generatedExercises].map(e => e.id));
    return { ...state, generatedExercises: [...state.generatedExercises, ...data.exercises.filter(e => !existing.has(e.id) && data.lessons.some(l => l.id === e.moduleId && l.status === 'ready'))] };
  };
  const findModule = async (id: string) => (await store.readLearning()).lessons.find(l => l.id === id && l.status === 'ready') ?? moduleMap.get(id);
  const ai = options.aiConfigured === false ? undefined : createPersonalizedAsk(options.ai, options.personalizationProvider, workspace, () => learning.personalizationChanged());
  const aiConfigured = options.aiConfigured ?? Boolean(ai);
  const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.4';
  const dist = options.distPath ?? process.env.ARI_DIST_PATH ?? join(process.cwd(), 'dist');
  const reviewQueue = new Map<string, Promise<DailyReview>>();
  const tutorQueue = new Map<string, { requestHash: string; task: Promise<Session> }>();
  const lessonQueue = new Map<string, { moduleId: string; message: string; language: 'en' | 'fr'; task: Promise<LessonSession> }>();
  const moduleLessonQueue = new Map<string, Promise<LessonSession>>();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = req.headers.host ?? '';
    const hostname = host.replace(/:\d+$/, '').toLowerCase();
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return res.status(403).json({ error: 'Loopback access only.' });
    const origin = req.headers.origin;
    if (origin) {
      let allowed = false;
      try { const parsed = new URL(origin); allowed = parsed.protocol === 'http:' && !parsed.username && !parsed.password && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && (parsed.host.toLowerCase() === host.toLowerCase() || ['3001', '3002', '5173', '5174', '5175'].includes(parsed.port)); } catch { /* invalid origin */ }
      if (!allowed) return res.status(403).json({ error: 'Origin not allowed.' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, PUT, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api', express.json({ limit: '7mb', type: 'application/json' }));
  app.use('/api/learning', learningRoutes(learning));
  app.use('/api/assessments', assessmentRoutes(assessments));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', aiConfigured, model, storage: 'sqlite',
    mainTutor: { configured: Boolean(learning.provider), model: learning.provider?.model ?? null } }));
  app.get('/api/camera/status', async (_req, res) => res.json(await cameraBridge.status()));
  app.post('/api/camera/start', async (_req, res) => {
    try { await cameraBridge.start(); res.json(await cameraBridge.status()); }
    catch (error) { throw new HttpError(503, error instanceof Error ? error.message : 'Could not start the IPEVO camera.'); }
  });
  app.post('/api/camera/stop', (_req, res) => {
    cameraBridge.stop();
    res.json({ running: false, label: 'IPEVO V4K' });
  });
  app.get('/api/camera/frame.jpg', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const frame = cameraBridge.latestFrame();
    const capturedAt = cameraBridge.frameTimestamp();
    if (!frame || !capturedAt || Date.now() - capturedAt > 5000) return res.status(503).json({ error: 'The camera is warming up or stopped. Start the IPEVO preview first.' });
    res.setHeader('X-Frame-Captured-At', String(capturedAt));
    res.type('image/jpeg').send(frame);
  });
  app.get('/api/state', async (_req, res) => res.json(await catalogState()));
  app.get('/api/snapshots/:id', (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(req.params.id)) throw new HttpError(400, 'Invalid snapshot ID.');
    const snapshot = store.getSnapshot(req.params.id);
    if (!snapshot) throw new HttpError(404, 'Snapshot not found.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(snapshot.mimeType).send(snapshot.data);
  });
  app.patch('/api/profile', async (req, res) => {
    const patch = body(profilePatchSchema, req.body);
    const profile = await store.update(state => { state.profile = { ...state.profile, ...patch }; return state.profile; });
    await learning.syncProfile(patch);
    res.json(profile);
  });
  app.put('/api/progress/:exerciseId', async (req, res) => {
    const id = req.params.exerciseId;
    const patch = body(progressPatchSchema, req.body);
    if (patch.exerciseId && patch.exerciseId !== id) throw new HttpError(400, 'Exercise ID does not match the route.');
    const state = await catalogState();
    if (!findExercise(state, id)) throw new HttpError(404, 'Exercise not found.');
    const progress = await store.update(draft => {
      const previous = draft.progress[id];
      const next: Progress = { ...defaultProgress(id), ...previous, ...patch, updatedAt: new Date().toISOString() };
      draft.progress[id] = next;
      return next;
    });
    res.json(progress);
  });
  app.post('/api/exercises/:exerciseId/pages', async (req, res) => {
    const input = body(pageRequestSchema, req.body);
    try { validateImage(input.image); } catch (error) { throw new HttpError(400, (error as Error).message); }
    const catalog = await catalogState();
    const page = await store.update(state => {
      if (!findExercise(catalog, req.params.exerciseId)) throw new HttpError(404, 'Exercise not found.');
      if (state.exercisePages.filter(item => item.exerciseId === req.params.exerciseId).length >= MAX_EXERCISE_PAGES)
        throw new HttpError(400, `This exercise already has ${MAX_EXERCISE_PAGES} saved pages.`);
      const saved = { id: randomUUID(), exerciseId: req.params.exerciseId, createdAt: new Date().toISOString(),
        snapshotId: store.saveSnapshot(input.image) };
      state.exercisePages.push(saved);
      return saved;
    });
    res.status(201).json(page);
  });
  app.delete('/api/exercises/:exerciseId/pages/:pageId', async (req, res) => {
    const catalog = await catalogState();
    await store.update(state => {
      if (!findExercise(catalog, req.params.exerciseId)) throw new HttpError(404, 'Exercise not found.');
      const index = state.exercisePages.findIndex(item => item.id === req.params.pageId && item.exerciseId === req.params.exerciseId);
      if (index < 0) throw new HttpError(404, 'Saved page not found.');
      state.exercisePages.splice(index, 1);
    });
    res.sendStatus(204);
  });
  app.post('/api/lesson-chat', async (req, res) => {
    const input = body(lessonChatRequestSchema, req.body);
    const module = await findModule(input.moduleId);
    if (!module) throw new HttpError(404, 'Module not found.');
    const state = await store.read();
    const saved = state.lessonSessions.find(session => session.id === input.id);
    const pending = lessonQueue.get(input.id);
    const language = input.language ?? saved?.language ?? pending?.language ?? state.profile.language;
    const matches = (session: { moduleId: string; requestText: string; language?: 'en' | 'fr' }) =>
      session.moduleId === input.moduleId && session.requestText === input.message && (session.language ?? language) === language;
    if (saved) {
      if (!matches(saved)) throw new HttpError(409, 'This message ID already belongs to a different lesson request.');
      return res.json(saved);
    }
    if (pending) {
      if (pending.moduleId !== input.moduleId || pending.message !== input.message || pending.language !== language)
        throw new HttpError(409, 'This message ID already belongs to a different lesson request.');
      return res.json(await pending.task);
    }
    if (!ai) throw new HttpError(503, 'AI tutoring is unavailable. Configure a provider to discuss a lesson.');
    const previous = moduleLessonQueue.get(module.id);
    const task = (async (): Promise<LessonSession> => {
      if (previous) await previous.catch(() => undefined);
      const current = await store.read();
      const { id, title, frenchTitle, subject, phase, summary, primer, objectives, prerequisites } = module;
      const payload = { lesson: { id, title, frenchTitle, subject, phase, summary, primer, objectives, prerequisites },
        profile: profileDefaults(current.profile), language, languageSource: input.language ? 'explicit request' : 'profile default', learnerMessage: input.message, history: lessonHistory(current, module.id) };
      const raw = await safeAI(ai, 'tutor', lessonInstructions, payload);
      const session: LessonSession = { id: input.id, moduleId: module.id, createdAt: new Date().toISOString(),
        requestText: input.message, language, response: normalizeLesson(raw) };
      return store.update(draft => {
        const existing = draft.lessonSessions.find(item => item.id === input.id);
        if (existing) {
          if (!matches(existing)) throw new HttpError(409, 'This message ID already belongs to a different lesson request.');
          return existing;
        }
        draft.lessonSessions.push(session);
        return session;
      });
    })();
    lessonQueue.set(input.id, { moduleId: module.id, message: input.message, language, task });
    moduleLessonQueue.set(module.id, task);
    try { res.json(await task); }
    finally {
      if (lessonQueue.get(input.id)?.task === task) lessonQueue.delete(input.id);
      if (moduleLessonQueue.get(module.id) === task) moduleLessonQueue.delete(module.id);
    }
  });
  app.post('/api/tutor', async (req, res) => {
    const input = body(tutorRequestSchema, req.body);
    if (input.mode === 'check' && input.image === undefined && !input.pageIds?.length && !input.message?.trim()) throw new HttpError(400, 'Provide a photo or typed work to check.');
    if (input.mode === 'question' && !input.message?.trim()) throw new HttpError(400, 'Write a question for the tutor.');
    if (input.mode === 'chat' && input.image === undefined && !input.pageIds?.length && !input.message?.trim()) throw new HttpError(400, 'Write a message or share a photo with the tutor.');
    const id = input.id ?? randomUUID();
    const requestHash = createHash('sha256').update(JSON.stringify({
      exerciseId: input.exerciseId, mode: input.mode, message: input.message ?? '',
      image: input.image ?? null, pageIds: input.pageIds ?? [],
      hintLevel: input.hintLevel ?? null, language: input.language ?? null,
    })).digest('hex');
    const conflict = () => new HttpError(409, 'This message ID already belongs to a different tutor request.');
    const pending = tutorQueue.get(id);
    if (pending) {
      if (pending.requestHash !== requestHash) throw conflict();
      return res.json(await pending.task);
    }
    const task = (async (): Promise<Session> => {
      const saved = (await store.read()).sessions.find(session => session.id === id);
      if (saved) {
        if (saved.requestHash !== requestHash) throw conflict();
        return saved;
      }
      const state = await catalogState();
      const exercise = findExercise(state, input.exerciseId);
      if (!exercise) throw new HttpError(404, 'Exercise not found.');
      const submitted = submittedImages(store, state, exercise.id, input.pageIds, input.image);
      if (!ai) throw new HttpError(503, 'AI tutoring is unavailable. Configure a provider to request feedback.');
      const payload = { exercise, mode: input.mode, hintLevel: input.hintLevel ?? Math.min(3, (state.progress[exercise.id]?.hintCount ?? 0) + 1),
        language: input.language ?? state.profile.language, languageSource: input.language ? 'explicit request' : 'profile default', learnerMessage: input.message ?? '', history: storedHistory(state, exercise.id),
        imageOrder: submitted.imageOrder };
      const raw = await safeAI(ai, 'tutor', tutorInstructions(input.mode), payload,
        submitted.images.length > 1 ? submitted.images : submitted.images[0]);
      const response = normalizeTutor(raw, input.mode, exercise, Boolean(submitted.images.length || input.message?.trim()), payload.language);
      return store.update(draft => {
        const existing = draft.sessions.find(session => session.id === id);
        if (existing) {
          if (existing.requestHash !== requestHash) throw conflict();
          return existing;
        }
        const previous = draft.progress[exercise.id];
        draft.progress[exercise.id] = { ...defaultProgress(exercise.id), ...previous, updatedAt: new Date().toISOString(),
          hintCount: (previous?.hintCount ?? 0) + (input.mode === 'hint' ? 1 : 0),
          lastScore: response.score ?? previous?.lastScore ?? null };
        const snapshotIds = [...submitted.snapshotIds, ...(input.image !== undefined ? [store.saveSnapshot(input.image)] : [])];
        const session: Session = { id, requestHash, createdAt: new Date().toISOString(), exerciseId: exercise.id, mode: input.mode,
          requestText: input.message ?? '', response, ...(snapshotIds.length ? { snapshotId: snapshotIds.at(-1), snapshotIds } : {}) };
        draft.sessions.push(session);
        return session;
      });
    })();
    tutorQueue.set(id, { requestHash, task });
    try { res.json(await task); }
    finally { if (tutorQueue.get(id)?.task === task) tutorQueue.delete(id); }
  });
  app.post('/api/reflections', async (req, res) => {
    const input = body(reflectionRequestSchema, req.body);
    const state = await catalogState();
    if (!findExercise(state, input.exerciseId)) throw new HttpError(404, 'Exercise not found.');
    const submitted = submittedImages(store, state, input.exerciseId, input.pageIds, input.image);
    const result = await store.update(draft => {
      const previous = draft.progress[input.exerciseId];
      const progress: Progress = { ...defaultProgress(input.exerciseId), ...previous, status: 'completed', confidence: input.confidence,
        notes: input.notes, updatedAt: new Date().toISOString() };
      draft.progress[input.exerciseId] = progress;
      const snapshotIds = [...submitted.snapshotIds, ...(input.image !== undefined ? [store.saveSnapshot(input.image)] : [])];
      const reflection = { id: randomUUID(), exerciseId: input.exerciseId, createdAt: progress.updatedAt, confidence: input.confidence,
        notes: input.notes, ...(snapshotIds.length ? { snapshotId: snapshotIds.at(-1), snapshotIds } : {}) };
      draft.reflections.push(reflection);
      return { progress, reflection };
    });
    // Durable analysis is queued after saving; provider latency cannot delay the reflection.
    void learning.reviewReflection(result.reflection.id).catch(() => undefined);
    res.status(201).json(result);
  });
  app.post('/api/reviews/daily', async (req, res) => {
    const input = body(dailyReviewRequestSchema, req.body);
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }); }
    catch { throw new HttpError(400, 'Invalid time zone.'); }
    const key = `${input.date}|${input.timeZone}`;
    const previous = reviewQueue.get(key);
    const task = (async (): Promise<DailyReview> => {
      if (previous) await previous.catch(() => undefined);
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await store.read();
        const evidence = reviewEvidence(state, input.date, input.timeZone);
        if (!evidence.sessions.length && !evidence.lessonSessions.length && !evidence.reflections.length && !evidence.progress.length)
          throw new HttpError(400, 'No study activity was saved for this date.');
        const prior = state.dailyReviews.find(review => review.date === input.date && review.timeZone === input.timeZone);
        if (prior?.evidenceFingerprint === evidence.evidenceFingerprint) return prior;
        if (!ai) throw new HttpError(503, 'AI daily review is unavailable. The reflection remains saved.');
        const reviewModules = (await store.readLearning()).lessons.filter(l => l.status === 'ready');
        const payload = { date: input.date, timeZone: input.timeZone,
          profile: profileDefaults(state.profile), progress: evidence.progress,
          lessonSessions: evidence.lessonSessions,
          sessions: evidence.sessions.map(({ id, createdAt, exerciseId, mode, requestText, response }) => ({ id, createdAt, exerciseId, mode, requestText, response })),
          reflections: evidence.reflections.map(({ id, createdAt, exerciseId, confidence, notes }) => ({ id, createdAt, exerciseId, confidence, notes })),
          modules: reviewModules.map(({ id, title, subject, phase }) => ({ id, title, subject, phase })) };
        const raw = await safeAI(ai, 'review', reviewInstructions, payload);
        const parsed = reviewOutputSchema.safeParse(raw);
        if (!parsed.success || parsed.data.recommendedModuleIds.some(id => !reviewModules.some(module => module.id === id)))
          throw new HttpError(502, 'The daily review returned invalid recommendations. Try again.');
        const review: DailyReview = { ...parsed.data, id: randomUUID(), date: input.date, timeZone: input.timeZone,
          createdAt: new Date().toISOString(), evidenceFingerprint: evidence.evidenceFingerprint,
          evidenceSessionIds: evidence.sessions.map(item => item.id), evidenceReflectionIds: evidence.reflections.map(item => item.id),
          evidenceLessonSessionIds: evidence.lessonSessions.map(item => item.id) };
        await store.update(draft => {
          const fresh = reviewEvidence(draft, input.date, input.timeZone);
          if (fresh.evidenceFingerprint !== evidence.evidenceFingerprint) return;
          draft.dailyReviews = draft.dailyReviews.filter(item => item.date !== input.date || item.timeZone !== input.timeZone);
          draft.dailyReviews.push(review);
        });
        // A reflection may arrive during generation; review the newer evidence before replying.
        const latest = await store.read();
        if (reviewEvidence(latest, input.date, input.timeZone).evidenceFingerprint !== evidence.evidenceFingerprint)
          continue;
        await workspace.write(`memories/reviews/${review.date}-${review.id}.md`,
          `# Daily learning review\n\nDate: ${review.date}\nCreated: ${review.createdAt}\nTime zone: ${review.timeZone}\nEvidence sessions: ${review.evidenceSessionIds.join(', ') || 'none'}\nEvidence reflections: ${review.evidenceReflectionIds.join(', ') || 'none'}\nEvidence lessons: ${(review.evidenceLessonSessionIds ?? []).join(', ') || 'none'}\n\n${review.summary}\n\n## Observations\n${review.memories.map(memory => `- ${memory}`).join('\n')}\n\n## Next steps\n${review.nextSteps.map(step => `- ${step}`).join('\n')}\n`,
          { expectedHash: null, actor: 'ari', reason: 'Dated review of saved study evidence' });
        return review;
      }
      throw new HttpError(409, 'New work arrived during review. Request the daily review again.');
    })();
    reviewQueue.set(key, task);
    try { res.json(await task); }
    finally { if (reviewQueue.get(key) === task) reviewQueue.delete(key); }
  });
  app.post('/api/exercises/generate', async (req, res) => {
    const input = body(generateRequestSchema, req.body);
    const module = await findModule(input.moduleId);
    if (!module) throw new HttpError(404, 'Module not found.');
    if (!ai) throw new HttpError(503, 'AI exercise generation is unavailable. Configure a provider.');
    const currentState = await store.read();
    const language = currentState.profile.language;
    const examples = (await catalogState()).generatedExercises.concat(curatedExercises).filter(e => e.moduleId === module.id).map(({ title, prompt }) => ({ title, prompt }));
    const proposed = await safeAI(ai, 'generate', generateInstructions, { module, difficulty: input.difficulty, language, examples, profile: profileDefaults(currentState.profile) });
    const parsed = exerciseSchema.safeParse({ ...(proposed as object), id: `generated-${randomUUID()}`, moduleId: module.id, difficulty: input.difficulty, generated: true });
    if (!parsed.success || parsed.data.hints.length !== 3 || parsed.data.rubric.reduce((sum, c) => sum + c.points, 0) !== 10)
      throw new HttpError(502, 'The generated exercise failed quality checks. Try again.');
    let exercise: Exercise;
    try { exercise = normalizeGeneratedMath(parsed.data); }
    catch { throw new HttpError(502, 'The generated exercise has invalid math formatting. Try again.'); }
    const verification = await safeAI(ai, 'verify', verifyInstructions, { exercise, language });
    const verdict = z.object({ valid: z.boolean(), reason: z.string() }).strict().safeParse(verification);
    if (!verdict.success || !verdict.data.valid) throw new HttpError(502, 'The generated exercise could not be verified. Try again.');
    await store.update(state => { state.generatedExercises.push(exercise); });
    res.status(201).json(exercise);
  });
  app.get('/api/export', async (_req, res) => {
    const state = await store.read();
    res.setHeader('Content-Disposition', 'attachment; filename="ari-data.json"');
    res.type('application/json').send(JSON.stringify(state, null, 2));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.use((req, res, next) => { if (req.method !== 'GET') return next(); res.sendFile(join(dist, 'index.html')); });
  }
  app.use((error: unknown, _req: Request, res: Response, _next: (error?: unknown) => void) => {
    if (res.headersSent) return;
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof PersonalizationError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid data.' });
    const e = error as { type?: string; status?: number };
    if (e?.type === 'entity.too.large' || e?.status === 413) return res.status(413).json({ error: 'Request exceeds the 7 MB limit.' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    return res.status(500).json({ error: 'Server could not complete the request.' });
  });
  return app;
}
