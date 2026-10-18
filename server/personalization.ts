import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import type { OnboardingAnswers, OnboardingState, PersonalizationActor, PersonalizationDocument, PersonalizationEntry, PersonalizationMetadata, PersonalizationMutation, PersonalizationRead, PersonalizationRevision, PersonalizationView } from '../shared/personalization.js';
import { defaultLearning, defaultState, type StateStore } from './state.js';

export const CORE_DOCUMENT_LIMIT = 12000;
export const MEMORY_DOCUMENT_LIMIT = 64000;
const MAX_FILES = 5000;
const MARKER = '.ari-workspace.json';
const tutorTemplate = `# How Ari should teach\n\nHelp the learner build lasting understanding in any subject. Ask about their goals and starting point. Explain clearly, offer useful hints, and adapt from evidence.\n\nKeep a mature, encouraging tone. Separate confirmed facts from tentative observations. Ask before creating or substantially changing a curriculum. Respect the learner's preferences and boundaries.\n\nUse USER.md for learner-provided goals and preferences. Read relevant memory files when needed. Record durable observations with their evidence and date; revise them when new evidence disagrees. Never invent personal facts.\n`;

export class PersonalizationError extends Error {
  readonly status: number;
  constructor(readonly code: 'invalid_path' | 'not_found' | 'conflict' | 'too_large' | 'invalid_input' | 'workspace_mismatch', message: string) {
    super(message);
    this.name = 'PersonalizationError';
    this.status = code === 'not_found' ? 404 : code === 'conflict' || code === 'workspace_mismatch' ? 409 : 400;
  }
}

const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const failure = (code: PersonalizationError['code'], message: string): never => { throw new PersonalizationError(code, message); };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const boundedInteger = (value: number, min: number, max: number) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) failure('invalid_input', `Expected an integer between ${min} and ${max}.`);
  return value;
};

/** Markdown is authoritative. SQLite holds binding/onboarding metadata and immutable history only. */
export class PersonalizationWorkspace {
  readonly rootPath: string;
  private initialized?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: StateStore, rootPath: string) {
    let absolute = resolve(rootPath);
    // macOS exposes system directories through these aliases (including tmpdir()).
    // Normalize only OS aliases; user-created ancestor/root symlinks are still rejected.
    if (process.platform === 'darwin') {
      const alias = ['/var', '/tmp', '/etc'].find(prefix => absolute === prefix || absolute.startsWith(`${prefix}/`));
      if (alias) absolute = join(realpathSync(alias), absolute.slice(alias.length));
    }
    this.rootPath = absolute;
  }

  private exclusive<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  ready(): Promise<void> {
    this.initialized ??= this.exclusive(() => this.initialize()).catch(error => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  private validatePath(path: string, directory = false): string {
    if (typeof path !== 'string' || path.length > 500 || isAbsolute(path) || path.includes('\\') || path.includes('\0')) failure('invalid_path', 'Use a relative Markdown path inside the personalization workspace.');
    if (directory && path === '') return path;
    const parts = path.split('/');
    if (parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === '..' || part === '.' || part.endsWith('.'))) failure('invalid_path', 'Hidden files and path traversal are not allowed.');
    const core = path === 'TUTOR.md' || path === 'USER.md';
    if (!core && !(parts[0] === 'memories' && (directory || (parts.length > 1 && parts.at(-1)!.endsWith('.md'))))) failure('invalid_path', 'Only TUTOR.md, USER.md, and Markdown files under memories/ are available.');
    return path;
  }

  private checkComponents(absolutePath: string): void {
    const { root } = parse(absolutePath);
    let current = root;
    for (const part of absolutePath.slice(root.length).split('/').filter(Boolean)) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) failure('invalid_path', 'Symbolic links are not allowed in the personalization workspace.');
      } catch (error) { if (!missing(error)) throw error; }
    }
  }

  private absolute(path: string): string {
    const absolute = join(this.rootPath, path);
    this.checkComponents(absolute);
    return absolute;
  }

  private diskContent(path: string): string | null {
    const absolute = this.absolute(path);
    let fd: number;
    try { fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (missing(error)) return null; throw error; }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) failure('invalid_path', 'The requested path is not a regular file.');
      if ((stat.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
      if (stat.size > this.contentLimit(path) * 4) failure('too_large', 'This personalization document exceeds its size limit.');
      const bytes = readFileSync(fd);
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return failure('invalid_input', 'Personalization documents must contain valid UTF-8 text.'); }
      this.validateContent(path, content);
      return content;
    } finally { closeSync(fd); }
  }

  private contentLimit(path: string): number { return path === 'TUTOR.md' || path === 'USER.md' ? CORE_DOCUMENT_LIMIT : MEMORY_DOCUMENT_LIMIT; }
  private validateContent(path: string, content: string): void {
    if (typeof content !== 'string' || content.includes('\0')) failure('invalid_input', 'Document content must be text without null bytes.');
    if (content.length > this.contentLimit(path)) failure('too_large', `Document exceeds ${this.contentLimit(path)} characters.`);
  }

  private observe(path: string, actor: PersonalizationActor = 'external', reason?: string): PersonalizationRevision | null {
    const content = this.diskContent(path);
    const previous = this.store.readPersonalizationRevisions(path, 0, 1)[0];
    if (content === null) {
      if (previous && !previous.deleted) this.record(path, '', 'external', 'File removed outside Ari.', true);
      return null;
    }
    if (previous && !previous.deleted && previous.hash === hash(content)) return previous;
    return this.record(path, content, actor, reason);
  }

  private record(path: string, content: string, actor: PersonalizationActor, reason?: string, deleted = false): PersonalizationRevision {
    const previous = this.store.readPersonalizationRevisions(path, 0, 1)[0];
    const revision: PersonalizationRevision = { path, content, hash: hash(content), revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), actor, ...(reason ? { reason } : {}), ...(deleted ? { deleted: true } : {}) };
    this.store.savePersonalizationRevision(revision);
    return revision;
  }

  private replace(path: string, content: string, expectedHash: string | null): void {
    const absolute = this.absolute(path);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    this.checkComponents(absolute);
    const temporary = join(dirname(absolute), `.ari-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
      // Observe again immediately before publication so direct edits are never silently overwritten.
      const current = this.observe(path);
      if ((current?.hash ?? null) !== expectedHash) failure('conflict', 'This document changed. Read its latest version before saving.');
      this.checkComponents(absolute);
      renameSync(temporary, absolute);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  private mutate(path: string, content: string, mutation: PersonalizationMutation): PersonalizationDocument {
    this.validatePath(path);
    this.validateContent(path, content);
    this.validateMutation(mutation);
    const previous = this.observe(path);
    if ((previous?.hash ?? null) !== mutation.expectedHash) failure('conflict', 'This document changed. Read its latest version before saving.');
    if (previous && previous.content === content) return previous;
    this.replace(path, content, mutation.expectedHash);
    return this.record(path, content, mutation.actor, mutation.reason);
  }

  private validateMutation(mutation: PersonalizationMutation): void {
    if (!mutation || !['user', 'ari'].includes(mutation.actor) || (mutation.expectedHash !== null && !/^[a-f0-9]{64}$/.test(mutation.expectedHash)) || (mutation.reason !== undefined && (typeof mutation.reason !== 'string' || mutation.reason.length > 1000))) failure('invalid_input', 'A current content hash and valid actor are required.');
  }

  private async initialize(): Promise<void> {
    this.checkComponents(this.rootPath);
    mkdirSync(this.rootPath, { recursive: true, mode: 0o700 });
    chmodSync(this.rootPath, 0o700);
    const markerPath = this.absolute(MARKER);
    let metadata = this.store.readPersonalizationMetadata();
    if (metadata && metadata.rootPath !== this.rootPath) failure('workspace_mismatch', 'This database is bound to a different personalization workspace.');
    if (existsSync(markerPath)) {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { workspaceId?: unknown };
      if (!metadata || marker.workspaceId !== metadata.workspaceId) failure('workspace_mismatch', 'This personalization workspace belongs to a different database. Use an isolated workspace for this database.');
    } else if (metadata) {
      failure('workspace_mismatch', 'The workspace binding file is missing. Restore it with the database backup before continuing.');
    } else {
      const now = new Date().toISOString();
      metadata = { rootPath: this.rootPath, workspaceId: randomUUID(), migrated: false, onboarding: { status: 'new', updatedAt: now } };
      writeFileSync(markerPath, JSON.stringify({ workspaceId: metadata.workspaceId }) + '\n', { mode: 0o600, flag: 'wx' });
      this.store.savePersonalizationMetadata(metadata);
    }
    if (metadata!.migrated) return;
    const [state, learning] = await Promise.all([this.store.read(), this.store.readLearning()]);
    const defaults = defaultState();
    const initialMemory = defaultLearning(state, learning.learnerId).memory.content;
    const imported = JSON.stringify(state.profile) !== JSON.stringify(defaults.profile) || Object.keys(state.progress).length > 0 || state.plan !== null || state.generatedExercises.length > 0 || state.exercisePages.length > 0 || state.sessions.length > 0 || state.reflections.length > 0 || state.dailyReviews.length > 0 || state.lessonSessions.length > 0 || learning.messages.length > 0 || learning.materials.length > 0 || learning.proposals.length > 0 || learning.runs.length > 0 || learning.events.length > 0 || learning.memory.content !== initialMemory || learning.memory.revision > 1 || learning.curricula.some(item => item.source !== 'original');
    const seed = (path: string, content: string) => {
      this.validatePath(path);
      this.validateContent(path, content);
      const existing = this.observe(path, 'migration', 'Existing Markdown preserved during migration.');
      if (existing && (!path.startsWith('memories/') || existing.content === content)) return path;
      const destination = existing ? `${path.slice(0, -3)}-import-${hash(content).slice(0, 32)}.md` : path;
      const previousImport = this.observe(destination, 'migration');
      if (previousImport?.content === content) return destination;
      if (previousImport) failure('conflict', 'An import destination already contains different notes. Original files were preserved.');
      this.replace(destination, content, null);
      this.record(destination, content, 'migration', 'Imported without changing original learning records.');
      return destination;
    };
    const seedLongMemory = (path: string, content: string) => {
      for (let offset = 0; offset < content.length || offset === 0; offset += MEMORY_DOCUMENT_LIMIT) {
        const part = offset === 0 ? path : `${path.slice(0, -3)}-part-${Math.floor(offset / MEMORY_DOCUMENT_LIMIT) + 1}.md`;
        seed(part, content.slice(offset, offset + MEMORY_DOCUMENT_LIMIT));
      }
    };
    seed('TUTOR.md', tutorTemplate);
    const importedMemoryPath = imported ? seed('memories/imported/learner-notes.md', learning.memory.content) : null;
    const importedPointer = importedMemoryPath ? `\n## Earlier learning notes\n\nEarlier learner notes are preserved in \`${importedMemoryPath}\`. Read that file only when relevant. These older observations may be outdated; current learner corrections and confirmed preferences take precedence.\n` : '';
    seed('USER.md', `# About the learner\n\nThe following preferences were explicitly saved in profile settings. Update them as your goals change.\n\n- Name: ${state.profile.name}\n- Preferred language: ${state.profile.language}\n- Goal: ${state.profile.goal}\n- Preferred session length: ${state.profile.sessionMinutes} minutes\n- Sessions per week: ${state.profile.sessionsPerWeek}\n\n## Starting point\n\nAsk the learner; establish knowledge from learning evidence.\n${importedPointer}`);
    const user = this.required('USER.md');
    if (importedMemoryPath && !user.content.includes(importedMemoryPath)) {
      const content = user.content + importedPointer;
      this.validateContent('USER.md', content);
      this.replace('USER.md', content, user.hash);
      this.record('USER.md', content, 'migration', 'Added a discovery pointer while preserving existing learner notes.');
    }
    const filename = (id: string) => hash(id).slice(0, 32);
    for (const review of state.dailyReviews) {
      const content = `# Daily review: ${review.date}\n\nReview ID: ${review.id}\nCreated: ${review.createdAt}\nTime zone: ${review.timeZone}\nEvidence session IDs: ${review.evidenceSessionIds.join(', ')}\nEvidence reflection IDs: ${review.evidenceReflectionIds.join(', ')}\nEvidence lesson session IDs: ${(review.evidenceLessonSessionIds ?? []).join(', ')}\n\n${review.summary}\n\n## Strengths\n${review.strengths.map(item => `- ${item}`).join('\n')}\n\n## Gaps\n${review.gaps.map(item => `- ${item}`).join('\n')}\n\n## Next steps\n${review.nextSteps.map(item => `- ${item}`).join('\n')}\n\n## Observations\n${review.memories.map(item => `- ${item}`).join('\n')}\n`;
      seedLongMemory(`memories/reviews/${filename(review.id)}.md`, content);
    }
    for (const reflection of state.reflections) seed(`memories/reflections/${filename(reflection.id)}.md`, `# Learner reflection\n\nReflection ID: ${reflection.id}\nExercise ID: ${reflection.exerciseId}\nCreated: ${reflection.createdAt}\nConfidence: ${reflection.confidence}/5\n\n${reflection.notes}\n`);
    const now = new Date().toISOString();
    this.store.savePersonalizationMetadata({ ...metadata!, migrated: true, onboarding: { status: imported ? 'imported' : 'new', updatedAt: now, ...(imported ? { completedAt: now } : {}) } });
  }

  private required(path: string): PersonalizationRevision {
    this.validatePath(path);
    return this.observe(path) ?? failure('not_found', 'Personalization document not found.');
  }

  async context(): Promise<{ tutor: string; user: string }> {
    await this.ready();
    return this.exclusive(() => ({ tutor: this.required('TUTOR.md').content, user: this.required('USER.md').content }));
  }

  private entries(path = ''): PersonalizationEntry[] {
    this.validatePath(path, true);
    const paths: string[] = [];
    const walk = (relative: string) => {
      const absolute = this.absolute(relative);
      if (!existsSync(absolute)) return;
      const stat = lstatSync(absolute);
      if (stat.isFile()) { this.validatePath(relative); paths.push(relative); return; }
      if (!stat.isDirectory()) failure('invalid_path', 'Only regular files and directories are available.');
      for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (!relative && !['TUTOR.md', 'USER.md', 'memories'].includes(entry.name)) continue;
        if (entry.isSymbolicLink()) failure('invalid_path', 'Symbolic links are not allowed in the personalization workspace.');
        if (entry.isDirectory()) { this.validatePath(child, true); walk(child); }
        else if (entry.name.endsWith('.md')) { this.validatePath(child); paths.push(child); }
        if (paths.length > MAX_FILES) failure('too_large', `Workspace exceeds ${MAX_FILES} Markdown files.`);
      }
    };
    walk(path);
    return paths.map(item => {
      const document = this.required(item);
      const { content, reason: _reason, deleted: _deleted, ...entry } = document;
      return { ...entry, characters: content.length };
    });
  }

  private currentView(includeFiles = true): PersonalizationView {
    return { tutor: this.required('TUTOR.md'), user: this.required('USER.md'), files: includeFiles ? this.entries() : [], onboarding: this.store.readPersonalizationMetadata()!.onboarding };
  }

  async view(): Promise<PersonalizationView> { await this.ready(); return this.exclusive(() => this.currentView()); }

  /** Fast state for chat/SSE refreshes. Memory files are browsed only on request. */
  async coreView(): Promise<PersonalizationView> {
    await this.ready();
    return this.exclusive(() => this.currentView(false));
  }

  async list(path = '', offset = 0, limit = 100): Promise<{ files: PersonalizationEntry[]; total: number; offset: number; truncated: boolean }> {
    await this.ready();
    boundedInteger(offset, 0, MAX_FILES); boundedInteger(limit, 1, 200);
    return this.exclusive(() => { const files = this.entries(path); return { files: files.slice(offset, offset + limit), total: files.length, offset, truncated: offset + limit < files.length }; });
  }

  async read(path: string, offset = 0, limit = CORE_DOCUMENT_LIMIT): Promise<PersonalizationRead> {
    await this.ready();
    boundedInteger(offset, 0, MEMORY_DOCUMENT_LIMIT); boundedInteger(limit, 1, MEMORY_DOCUMENT_LIMIT);
    return this.exclusive(() => { const document = this.required(path); return { ...document, content: document.content.slice(offset, offset + limit), offset, total: document.content.length, truncated: offset + limit < document.content.length }; });
  }

  async search(query: string, path = '', limit = 50): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
    await this.ready();
    if (typeof query !== 'string' || !query.trim() || query.length > 300) failure('invalid_input', 'Search requires between 1 and 300 characters.');
    boundedInteger(limit, 1, 100);
    return this.exclusive(() => {
      const matches: { path: string; line: number; text: string }[] = [];
      const needle = query.toLocaleLowerCase();
      for (const entry of this.entries(path)) {
        const lines = this.required(entry.path).content.split('\n');
        for (let index = 0; index < lines.length; index++) if (lines[index].toLocaleLowerCase().includes(needle)) {
          if (matches.length >= limit) return { matches, truncated: true };
          matches.push({ path: entry.path, line: index + 1, text: lines[index].slice(0, 500) });
        }
      }
      return { matches, truncated: false };
    });
  }

  async write(path: string, content: string, mutation: PersonalizationMutation): Promise<PersonalizationDocument> {
    await this.ready(); return this.exclusive(() => this.mutate(path, content, mutation));
  }

  async edit(path: string, oldText: string, newText: string, mutation: PersonalizationMutation): Promise<PersonalizationDocument> {
    await this.ready();
    return this.exclusive(() => {
      const document = this.required(path);
      if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string') failure('invalid_input', 'Edit requires nonempty original text and replacement text.');
      const index = document.content.indexOf(oldText);
      if (index < 0 || document.content.indexOf(oldText, index + 1) !== -1) failure('conflict', 'Original text must match exactly once. Read the document before editing.');
      return this.mutate(path, document.content.slice(0, index) + newText + document.content.slice(index + oldText.length), mutation);
    });
  }

  async move(path: string, destination: string, mutation: PersonalizationMutation): Promise<PersonalizationDocument> {
    await this.ready();
    return this.exclusive(() => {
      this.validatePath(path); this.validatePath(destination); this.validateMutation(mutation);
      if (!path.startsWith('memories/') || !destination.startsWith('memories/')) failure('invalid_path', 'Core documents cannot be moved.');
      const source = this.required(path);
      if (source.hash !== mutation.expectedHash || this.observe(destination)) failure('conflict', 'The source changed or the destination already exists.');
      // Publish destination before removing source so interrupted moves preserve all content.
      this.replace(destination, source.content, null);
      const result = this.record(destination, source.content, mutation.actor, mutation.reason ?? `Moved from ${path}.`);
      if (this.required(path).hash !== source.hash) failure('conflict', 'The source changed during the move. Both files were preserved.');
      unlinkSync(this.absolute(path));
      this.record(path, '', mutation.actor, mutation.reason ?? `Moved to ${destination}.`, true);
      return result;
    });
  }

  async delete(path: string, mutation: PersonalizationMutation): Promise<void> {
    await this.ready();
    return this.exclusive(() => {
      this.validatePath(path); this.validateMutation(mutation);
      if (!path.startsWith('memories/')) failure('invalid_path', 'Core documents cannot be deleted.');
      if (this.required(path).hash !== mutation.expectedHash) failure('conflict', 'This document changed. Read its latest version before deleting.');
      unlinkSync(this.absolute(path));
      this.record(path, '', mutation.actor, mutation.reason, true);
    });
  }

  async revisions(path: string, offset = 0, limit = 50): Promise<PersonalizationRevision[]> {
    await this.ready();
    this.validatePath(path); boundedInteger(offset, 0, 1000000); boundedInteger(limit, 1, 100);
    return this.exclusive(() => { this.observe(path); return this.store.readPersonalizationRevisions(path, offset, limit); });
  }

  async restore(path: string, revision: number, mutation: PersonalizationMutation): Promise<PersonalizationDocument> {
    await this.ready();
    this.validatePath(path); boundedInteger(revision, 1, Number.MAX_SAFE_INTEGER);
    return this.exclusive(() => {
      const historical = this.store.readPersonalizationRevision(path, revision);
      if (!historical || historical.deleted) return failure('not_found', 'The requested historical document was not found.');
      return this.mutate(path, historical.content, { ...mutation, reason: mutation.reason ?? `Restored revision ${revision}.` });
    });
  }

  async onboarding(): Promise<OnboardingState> { await this.ready(); return this.exclusive(() => this.store.readPersonalizationMetadata()!.onboarding); }

  async skipOnboarding(): Promise<OnboardingState> {
    await this.ready();
    return this.exclusive(() => {
      const metadata = this.store.readPersonalizationMetadata()!;
      if (metadata.onboarding.status !== 'new') return metadata.onboarding;
      const now = new Date().toISOString();
      const onboarding: OnboardingState = { status: 'skipped', updatedAt: now, completedAt: now };
      this.store.savePersonalizationMetadata({ ...metadata, onboarding });
      return onboarding;
    });
  }

  async beginOnboarding(): Promise<OnboardingState> {
    await this.ready();
    return this.exclusive(() => {
      const metadata = this.store.readPersonalizationMetadata()!;
      const onboarding: OnboardingState = { status: 'new', updatedAt: new Date().toISOString() };
      this.store.savePersonalizationMetadata({ ...metadata, onboarding });
      return onboarding;
    });
  }

  async completeOnboarding(answers?: OnboardingAnswers): Promise<PersonalizationView> {
    await this.ready();
    return this.exclusive(() => {
      this.required('USER.md'); this.required('TUTOR.md');
      if (answers) {
        if (!answers || typeof answers.goals !== 'string' || !answers.goals.trim()) failure('invalid_input', 'Describe at least one learning goal.');
        for (const key of ['name', 'goals', 'startingLevel', 'learningPreferences', 'tutorStyle', 'boundaries'] as const) if (answers[key] !== undefined && (typeof answers[key] !== 'string' || answers[key]!.length > 3000)) failure('invalid_input', 'Each onboarding answer must be text of at most 3000 characters.');
        const user = this.required('USER.md');
        if (user.hash !== answers.expectedUserHash) failure('conflict', 'Learner notes changed. Read the latest document before completing setup.');
        const tutor = this.required('TUTOR.md');
        if (answers.tutorStyle && tutor.hash !== answers.expectedTutorHash) failure('conflict', 'Tutor guidance changed. Read the latest document before completing setup.');
        const notes = `\n## Learner-provided setup\n\n${answers.name ? `Name: ${answers.name}\n\n` : ''}### Goals\n${answers.goals}\n\n${answers.startingLevel ? `### Starting point\n${answers.startingLevel}\n\n` : ''}${answers.learningPreferences ? `### Learning preferences\n${answers.learningPreferences}\n\n` : ''}${answers.boundaries ? `### Boundaries\n${answers.boundaries}\n\n` : ''}`;
        const userContent = user.content + notes;
        const tutorContent = tutor.content + `\n## Learner-requested teaching style\n\n${answers.tutorStyle}\n`;
        this.validateContent('USER.md', userContent);
        if (answers.tutorStyle) this.validateContent('TUTOR.md', tutorContent);
        this.mutate('USER.md', userContent, { actor: 'user', expectedHash: user.hash, reason: 'Learner completed setup.' });
        if (answers.tutorStyle) this.mutate('TUTOR.md', tutorContent, { actor: 'user', expectedHash: tutor.hash, reason: 'Learner completed setup.' });
      }
      const metadata = this.store.readPersonalizationMetadata()!;
      const now = new Date().toISOString();
      this.store.savePersonalizationMetadata({ ...metadata, onboarding: { status: 'complete', completedAt: now, updatedAt: now } });
      return this.currentView(false);
    });
  }
}
