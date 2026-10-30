import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import type { AssessmentData } from '../shared/assessments.js';
import { assessmentDataSchema } from './assessment-schema.js';
import type { AppState, Exercise } from '../shared/types.js';
import type { LearnerMemory, LearningData, LearningLesson } from '../shared/learning.js';
import type { PersonalizationMetadata, PersonalizationRevision } from '../shared/personalization.js';
import { exercises, modules } from '../shared/curriculum.js';
import { stateSchema, validateImage } from './schema.js';
import { learningDataSchema } from './learning-schema.js';
import { originalPrimerHashes } from './original-primer-hashes.js';
import { repairLessonOrigins } from './learning-repairs.js';

const SCHEMA_VERSION = 4;
export const ORIGINAL_CURRICULUM_ID = 'original-prepa';

export interface LessonRevision { lesson: LearningLesson; exercises: Exercise[]; savedAt: string; }

export function defaultLearning(state: AppState, learnerId = 'local'): LearningData {
  const now = new Date().toISOString();
  const lessons: LearningLesson[] = modules.map(module => ({
    ...structuredClone(module), curriculumId: ORIGINAL_CURRICULUM_ID, status: 'ready', revision: 1,
    exerciseIds: [...module.exerciseIds, ...state.generatedExercises.filter(exercise => exercise.moduleId === module.id).map(exercise => exercise.id)],
  }));
  return {
    learnerId,
    curricula: [{
      id: ORIGINAL_CURRICULUM_ID, learnerId, title: 'French prépa mathematics and physics',
      description: 'The original foundation-to-prépa course.', topic: 'Mathematics and physics',
      level: 'Foundations to French classes préparatoires', goal: state.profile.goal,
      lessonIds: lessons.map(lesson => lesson.id), source: 'original', createdAt: now, updatedAt: now,
    }],
    lessons, exercises: structuredClone([...exercises, ...state.generatedExercises]),
    messages: [], proposals: [], materials: [], runs: [], events: [], context: [], contextTokens: 0,
    // Existing reflections remain available as evidence; the new background
    // pipeline starts with new work rather than generating an unsolicited backlog.
    reviewedEvidenceIds: state.reflections.map(reflection => reflection.id),
    memory: {
      content: `# Learner profile\n\nName: ${state.profile.name}\nPreferred language: ${state.profile.language}\nGoal: ${state.profile.goal}\nPreferred session length: ${state.profile.sessionMinutes} minutes\nSessions per week: ${state.profile.sessionsPerWeek}\n\nThese are saved profile settings. Knowledge and mastery should be established from learning evidence.`,
      revision: 1, updatedAt: now, updatedBy: 'user',
    },
  };
}

export const defaultState = (): AppState => ({
  profile: { name: 'Learner', language: 'en', sessionMinutes: 25, sessionsPerWeek: 4, goal: 'Explore a subject and develop lasting understanding.' },
  progress: {}, sessions: [], generatedExercises: [], plan: null,
  reflections: [], dailyReviews: [], exercisePages: [], lessonSessions: [],
});

type JsonRow = { payload: string };

export class StateStore {
  private readonly db: DatabaseSync;
  private inUpdate = false;
  private readonly learnerId: string;
  readonly dbPath: string;

  constructor(dbPath: string, options: { legacyPath?: string; learnerId?: string } = {}) {
    this.dbPath = dbPath;
    this.learnerId = options.learnerId ?? 'local';
    if (!this.learnerId || this.learnerId.length > 120) throw new Error('Invalid learner identity.');
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    const newDatabase = !existsSync(dbPath);
    this.db = new DatabaseSync(dbPath);
    try {
      if (newDatabase) chmodSync(dbPath, 0o600);
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.db.exec('PRAGMA journal_mode = WAL');
      this.initialize(options.legacyPath);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(work: () => T, readOnly = false): T {
    this.db.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private initialize(legacyPath?: string): void {
    this.transaction(() => {
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) {
        if (!tables.some(row => row.name === 'metadata')) throw new Error('Unrecognized state database schema.');
        const version = this.db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value?: string } | undefined;
        if (!['1', '2', '3', String(SCHEMA_VERSION)].includes(version?.value ?? '')) {
          throw new Error(`Unsupported state database schema version: ${version?.value ?? 'missing'}.`);
        }
        if (version?.value === '1') {
          this.db.exec('CREATE TABLE exercise_pages (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL)');
        }
        if (version?.value === '1' || version?.value === '2') {
          this.db.exec('CREATE TABLE lesson_sessions (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL)');
        }
        if (!this.db.prepare('SELECT 1 FROM profile WHERE id = 1').get()) throw new Error('State database is missing its profile.');
        this.initializeLearning();
        this.db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
        return;
      }

      let initial = defaultState();
      if (legacyPath && existsSync(legacyPath)) {
        let legacy: unknown;
        try {
          legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
        } catch (error) {
          throw new Error(`Cannot parse legacy state at ${legacyPath}. Original left untouched.`, { cause: error });
        }
        if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Legacy state must be an object. Original left untouched.');
        const normalized = { ...legacy, reflections: (legacy as Record<string, unknown>).reflections ?? [], dailyReviews: (legacy as Record<string, unknown>).dailyReviews ?? [], exercisePages: (legacy as Record<string, unknown>).exercisePages ?? [] };
        try {
          initial = stateSchema.parse(normalized) as AppState;
        } catch (error) {
          throw new Error(`Invalid legacy state at ${legacyPath}. Original left untouched.`, { cause: error });
        }
        try {
          copyFileSync(legacyPath, `${legacyPath}.backup`, constants.COPYFILE_EXCL);
          chmodSync(`${legacyPath}.backup`, 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (!readFileSync(legacyPath).equals(readFileSync(`${legacyPath}.backup`))) {
            throw new Error(`Legacy backup at ${legacyPath}.backup differs from the source. Migration stopped.`);
          }
        }
      }

      this.db.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
        CREATE TABLE progress (exercise_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE generated_exercises (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE plan (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
        CREATE TABLE reflections (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE daily_reviews (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE exercise_pages (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE lesson_sessions (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE snapshots (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, data BLOB NOT NULL);
      `);
      this.db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
      this.writeState(stateSchema.parse(initial) as AppState);
      this.initializeLearning();
    });
  }

  private initializeLearning(): void {
    // Additive migration: no legacy entity or snapshot is rewritten.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assessment_state (learner_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_state (learner_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_lesson_revisions (
        learner_id TEXT NOT NULL, lesson_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (learner_id, lesson_id, revision)
      );
      CREATE TABLE IF NOT EXISTS learning_memory_revisions (
        learner_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (learner_id, revision)
      );
      CREATE TABLE IF NOT EXISTS personalization_metadata (
        learner_id TEXT PRIMARY KEY, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personalization_revisions (
        learner_id TEXT NOT NULL, path TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (learner_id, path, revision)
      );
    `);
    if (!this.db.prepare('SELECT 1 FROM learning_state WHERE learner_id = ?').get(this.learnerId)) {
      this.writeLearning(learningDataSchema.parse(defaultLearning(this.loadState(), this.learnerId)) as LearningData);
    } else {
      const previous = this.loadLearning();
      const draft = structuredClone(previous);
      let changed = repairLessonOrigins(draft);
      for (const lesson of draft.lessons) {
        const bundled = modules.find(module => module.id === lesson.id);
        if (lesson.curriculumId !== ORIGINAL_CURRICULUM_ID || lesson.status !== 'ready' || !bundled || lesson.primer === bundled.primer) continue;
        const hash = createHash('sha256').update(lesson.primer).digest('hex');
        if (hash !== originalPrimerHashes[lesson.id]) continue;
        lesson.primer = bundled.primer;
        changed = true;
      }
      if (changed) {
        // Retain prior content and metadata before applying compatible repairs.
        this.writeLearning(previous);
        this.advanceRevisions(previous, draft);
        this.writeLearning(learningDataSchema.parse(draft) as LearningData);
      }
    }
  }

  private loadLearning(): LearningData {
    const row = this.db.prepare('SELECT payload FROM learning_state WHERE learner_id = ?').get(this.learnerId) as JsonRow | undefined;
    if (!row) throw new Error('Learning state is missing.');
    const data = learningDataSchema.parse(JSON.parse(row.payload)) as LearningData;
    if (data.learnerId !== this.learnerId) throw new Error('Learning state belongs to a different learner.');
    return data;
  }

  private writeLearning(data: LearningData): void {
    if (data.learnerId !== this.learnerId || data.curricula.some(curriculum => curriculum.learnerId !== this.learnerId)) {
      throw new Error('Learning state belongs to a different learner.');
    }
    const savedAt = new Date().toISOString();
    const insertRevision = this.db.prepare('INSERT OR IGNORE INTO learning_lesson_revisions (learner_id, lesson_id, revision, payload) VALUES (?, ?, ?, ?)');
    for (const lesson of data.lessons) {
      const revision: LessonRevision = { lesson, exercises: data.exercises.filter(exercise => lesson.exerciseIds.includes(exercise.id)), savedAt };
      insertRevision.run(this.learnerId, lesson.id, lesson.revision, JSON.stringify(revision));
    }
    this.db.prepare('INSERT OR IGNORE INTO learning_memory_revisions (learner_id, revision, payload) VALUES (?, ?, ?)')
      .run(this.learnerId, data.memory.revision, JSON.stringify(data.memory));
    this.db.prepare('INSERT INTO learning_state (learner_id, payload) VALUES (?, ?) ON CONFLICT(learner_id) DO UPDATE SET payload = excluded.payload')
      .run(this.learnerId, JSON.stringify(data));
  }

  private advanceRevisions(previous: LearningData, draft: LearningData): void {
    const content = (lesson: LearningLesson, data: LearningData) => {
      const { status: _status, error: _error, revision: _revision, ...fields } = lesson;
      return JSON.stringify({ lesson: fields, exercises: data.exercises.filter(exercise => lesson.exerciseIds.includes(exercise.id)) });
    };
    for (const lesson of draft.lessons) {
      const old = previous.lessons.find(item => item.id === lesson.id);
      if (!old) continue;
      if (lesson.revision < old.revision) throw new Error('Lesson revision cannot move backwards.');
      if (content(old, previous) !== content(lesson, draft)) lesson.revision = Math.max(lesson.revision, old.revision + 1);
    }
    if (draft.memory.revision < previous.memory.revision) throw new Error('Memory revision cannot move backwards.');
    if (draft.memory.content !== previous.memory.content) draft.memory.revision = Math.max(draft.memory.revision, previous.memory.revision + 1);
  }

  private loadAssessments(): AssessmentData {
    const row = this.db.prepare('SELECT payload FROM assessment_state WHERE learner_id = ?').get(this.learnerId) as JsonRow | undefined;
    return assessmentDataSchema.parse(row ? JSON.parse(row.payload) : { assessments: [] });
  }

  async readAssessments(): Promise<AssessmentData> {
    return this.transaction(() => this.loadAssessments(), true);
  }

  async updateAssessments<T>(mutate: (draft: AssessmentData) => T): Promise<T> {
    if (this.inUpdate) throw new Error('Nested state updates are not supported.');
    return this.transaction(() => {
      this.inUpdate = true;
      try {
        const draft = this.loadAssessments();
        const result = mutate(draft);
        if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('State mutation must be synchronous.');
        const data = assessmentDataSchema.parse(draft);
        this.db.prepare('INSERT INTO assessment_state (learner_id, payload) VALUES (?, ?) ON CONFLICT(learner_id) DO UPDATE SET payload = excluded.payload')
          .run(this.learnerId, JSON.stringify(data));
        return result;
      } finally { this.inUpdate = false; }
    });
  }

  async readLearning(): Promise<LearningData> {
    return this.transaction(() => this.loadLearning(), true);
  }

  async updateLearning<T>(mutate: (draft: LearningData) => T): Promise<T> {
    if (this.inUpdate) throw new Error('Nested state updates are not supported.');
    return this.transaction(() => {
      this.inUpdate = true;
      try {
        const previous = this.loadLearning();
        const draft = structuredClone(previous);
        const result = mutate(draft);
        if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('State mutation must be synchronous.');
        if (isDeepStrictEqual(previous, draft)) return result;
        this.advanceRevisions(previous, draft);
        this.writeLearning(learningDataSchema.parse(draft) as LearningData);
        return result;
      } finally {
        this.inUpdate = false;
      }
    });
  }

  async readLessonRevisions(lessonId: string): Promise<LessonRevision[]> {
    return this.transaction(() => (this.db.prepare('SELECT payload FROM learning_lesson_revisions WHERE learner_id = ? AND lesson_id = ? ORDER BY revision')
      .all(this.learnerId, lessonId) as unknown as JsonRow[]).map(row => JSON.parse(row.payload) as LessonRevision), true);
  }

  async readMemoryRevisions(): Promise<LearnerMemory[]> {
    return this.transaction(() => (this.db.prepare('SELECT payload FROM learning_memory_revisions WHERE learner_id = ? ORDER BY revision')
      .all(this.learnerId) as unknown as JsonRow[]).map(row => JSON.parse(row.payload) as LearnerMemory), true);
  }

  readPersonalizationMetadata(): PersonalizationMetadata | null {
    const row = this.db.prepare('SELECT payload FROM personalization_metadata WHERE learner_id = ?').get(this.learnerId) as JsonRow | undefined;
    return row ? JSON.parse(row.payload) as PersonalizationMetadata : null;
  }

  savePersonalizationMetadata(metadata: PersonalizationMetadata): void {
    const previous = this.readPersonalizationMetadata();
    if (previous && (previous.rootPath !== metadata.rootPath || previous.workspaceId !== metadata.workspaceId)) {
      throw new Error('Personalization workspace binding cannot be changed.');
    }
    this.db.prepare('INSERT INTO personalization_metadata (learner_id, payload) VALUES (?, ?) ON CONFLICT(learner_id) DO UPDATE SET payload = excluded.payload')
      .run(this.learnerId, JSON.stringify(metadata));
  }

  readPersonalizationRevisions(path: string, offset = 0, limit = 50): PersonalizationRevision[] {
    return (this.db.prepare('SELECT payload FROM personalization_revisions WHERE learner_id = ? AND path = ? ORDER BY revision DESC LIMIT ? OFFSET ?')
      .all(this.learnerId, path, limit, offset) as unknown as JsonRow[]).map(row => JSON.parse(row.payload) as PersonalizationRevision);
  }

  readPersonalizationRevision(path: string, revision: number): PersonalizationRevision | null {
    const row = this.db.prepare('SELECT payload FROM personalization_revisions WHERE learner_id = ? AND path = ? AND revision = ?')
      .get(this.learnerId, path, revision) as JsonRow | undefined;
    return row ? JSON.parse(row.payload) as PersonalizationRevision : null;
  }

  savePersonalizationRevision(revision: PersonalizationRevision): void {
    // Immutable history. Current content is always read from the Markdown files.
    this.db.prepare('INSERT INTO personalization_revisions (learner_id, path, revision, payload) VALUES (?, ?, ?, ?)')
      .run(this.learnerId, revision.path, revision.revision, JSON.stringify(revision));
  }

  private loadState(): AppState {
    const singleton = (table: 'profile' | 'plan'): unknown => {
      const row = this.db.prepare(`SELECT payload FROM ${table} WHERE id = 1`).get() as JsonRow | undefined;
      return row ? JSON.parse(row.payload) : null;
    };
    const list = (table: 'sessions' | 'generated_exercises' | 'reflections' | 'daily_reviews' | 'exercise_pages' | 'lesson_sessions'): unknown[] =>
      (this.db.prepare(`SELECT payload FROM ${table} ORDER BY ordinal`).all() as unknown as JsonRow[]).map(row => JSON.parse(row.payload));
    const progress: Record<string, unknown> = {};
    for (const row of this.db.prepare('SELECT exercise_id, payload FROM progress').all() as unknown as { exercise_id: string; payload: string }[]) {
      progress[row.exercise_id] = JSON.parse(row.payload);
    }
    return stateSchema.parse({
      profile: singleton('profile'), progress, sessions: list('sessions'),
      generatedExercises: list('generated_exercises'), plan: singleton('plan'),
      reflections: list('reflections'), dailyReviews: list('daily_reviews'), exercisePages: list('exercise_pages'), lessonSessions: list('lesson_sessions'),
    }) as AppState;
  }

  private writeState(state: AppState): void {
    const syncSingleton = (table: 'profile' | 'plan', value: unknown) => {
      const existing = this.db.prepare(`SELECT payload FROM ${table} WHERE id = 1`).get() as JsonRow | undefined;
      if (value === null) {
        if (existing) this.db.prepare(`DELETE FROM ${table} WHERE id = 1`).run();
      } else {
        const payload = JSON.stringify(value);
        if (existing?.payload !== payload) this.db.prepare(`INSERT INTO ${table} (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`).run(payload);
      }
    };
    syncSingleton('profile', state.profile);
    syncSingleton('plan', state.plan);

    const currentProgress = new Map((this.db.prepare('SELECT exercise_id, payload FROM progress').all() as unknown as { exercise_id: string; payload: string }[])
      .map(row => [row.exercise_id, row.payload] as const));
    const upsertProgress = this.db.prepare('INSERT INTO progress (exercise_id, payload) VALUES (?, ?) ON CONFLICT(exercise_id) DO UPDATE SET payload = excluded.payload');
    const removeProgress = this.db.prepare('DELETE FROM progress WHERE exercise_id = ?');
    for (const [id, progress] of Object.entries(state.progress)) {
      const payload = JSON.stringify(progress);
      if (currentProgress.get(id) !== payload) upsertProgress.run(id, payload);
      currentProgress.delete(id);
    }
    for (const id of currentProgress.keys()) removeProgress.run(id);

    const syncList = (table: 'sessions' | 'generated_exercises' | 'reflections' | 'daily_reviews' | 'exercise_pages' | 'lesson_sessions', values: { id: string }[]) => {
      const current = new Map((this.db.prepare(`SELECT id, ordinal, payload FROM ${table}`).all() as unknown as { id: string; ordinal: number; payload: string }[])
        .map(row => [row.id, row] as const));
      const upsert = this.db.prepare(`INSERT INTO ${table} (id, ordinal, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ordinal = excluded.ordinal, payload = excluded.payload`);
      const remove = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
      values.forEach((value, ordinal) => {
        const payload = JSON.stringify(value);
        const old = current.get(value.id);
        if (!old || old.ordinal !== ordinal || old.payload !== payload) upsert.run(value.id, ordinal, payload);
        current.delete(value.id);
      });
      for (const id of current.keys()) remove.run(id);
    };
    syncList('sessions', state.sessions);
    syncList('generated_exercises', state.generatedExercises);
    syncList('reflections', state.reflections);
    syncList('daily_reviews', state.dailyReviews);
    syncList('exercise_pages', state.exercisePages);
    syncList('lesson_sessions', state.lessonSessions);
  }

  async read(): Promise<AppState> {
    return this.transaction(() => this.loadState(), true);
  }

  async update<T>(mutate: (draft: AppState) => T): Promise<T> {
    if (this.inUpdate) throw new Error('Nested state updates are not supported.');
    return this.transaction(() => {
      this.inUpdate = true;
      try {
        const draft = this.loadState();
        const result = mutate(draft);
        if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('State mutation must be synchronous.');
        this.writeState(stateSchema.parse(draft) as AppState);
        return result;
      } finally {
        this.inUpdate = false;
      }
    });
  }

  saveSnapshot(dataUrl: string): string {
    if (!this.inUpdate) throw new Error('Snapshots must be saved inside a state update.');
    const validated = validateImage(dataUrl);
    const [, subtype, base64] = /^data:image\/(jpeg|png|webp);base64,(.*)$/.exec(validated)!;
    const data = Buffer.from(base64, 'base64');
    const hash = createHash('sha256').update(data).digest('hex');
    const existing = this.db.prepare('SELECT id FROM snapshots WHERE sha256 = ?').get(hash) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.db.prepare('INSERT INTO snapshots (id, sha256, mime_type, data) VALUES (?, ?, ?, ?)').run(id, hash, `image/${subtype}`, data);
    return id;
  }

  getSnapshot(id: string): { data: Buffer; mimeType: string } | null {
    const row = this.db.prepare('SELECT mime_type, data FROM snapshots WHERE id = ?').get(id) as { mime_type: string; data: Uint8Array } | undefined;
    return row ? { data: Buffer.from(row.data), mimeType: row.mime_type } : null;
  }

  close(): void {
    this.db.close();
  }
}
