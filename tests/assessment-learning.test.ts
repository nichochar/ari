import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StateStore, ORIGINAL_CURRICULUM_ID } from '../server/state.js';
import { LearningService } from '../server/learning-service.js';
import { PersonalizationWorkspace } from '../server/personalization.js';
import { fixtureLearningProvider } from './fixtures/learning.js';
import type { LearningAgentRequest } from '../server/learning-provider.js';
import type { Assessment } from '../shared/assessments.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
const laterImage = `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('later synthetic photo')]).toString('base64')}`;
async function fixture(run: (request: LearningAgentRequest) => Promise<{ output: unknown[]; text: string; inputTokens: number }>) {
  const dir = await mkdtemp(join(tmpdir(), 'ari-assessment-learning-')); const dbPath = join(dir, 'state.sqlite');
  let store = new StateStore(dbPath); let workspace = new PersonalizationWorkspace(store, join(dir, 'workspace'));
  const provider = fixtureLearningProvider(run);
  let service = new LearningService(store, provider, workspace); await workspace.ready(); await workspace.skipOnboarding();
  const a: Assessment = { id: 'assessment-one', curriculumId: ORIGINAL_CURRICULUM_ID, title: 'Evidence evaluation', createdAt: '2026-10-28T12:00:00.000Z', updatedAt: '2026-10-28T12:00:00.000Z', status: 'reviewed', lessonIds: ['topic'], minutes: 15, scopeReason: 'Review evidence.', instructions: '', answer: 'Later mutable answer that must not replace original.', problems: [{ id: 'p1', title: 'Claims', prompt: 'How would you test a claim?', lessonIds: ['topic'], points: 2, solution: 'Find independent evidence.', rubric: [{ criterion: 'Independent evidence', points: 2 }] }], pages: [], messages: [], submissions: [] };
  await store.updateAssessments(data => {
    const snapshot = store.saveSnapshot(image), later = store.saveSnapshot(laterImage);
    a.messages = [{ id: 'before', role: 'user', content: 'I prefer diagrams. Can you clarify what independent means?', createdAt: a.createdAt, status: 'complete', snapshotIds: [snapshot], help: 'none', problemIds: ['p1'] }, { id: 'clarification', role: 'assistant', content: 'An independent source is separate from the claimant.', createdAt: a.createdAt, status: 'complete', snapshotIds: [], help: 'clarification', problemIds: ['p1'] }, { id: 'later', role: 'assistant', content: 'Later teaching solution that must not count as attempt help.', createdAt: '2026-10-28T13:00:00.000Z', status: 'complete', snapshotIds: [later], help: 'solution', problemIds: ['p1'] }];
    a.pages = [{ id: 'later-page', snapshotId: later, createdAt: a.createdAt }];
    a.submissions = [{ id: 'revision', createdAt: a.createdAt, answer: 'Original answer: compare with an independent source.', snapshotIds: [snapshot], messageIds: ['before', 'clarification'], status: 'complete', review: { summary: 'Your comparison is well supported.', score: 2, maxScore: 2, problems: [{ problemId: 'p1', score: 2, maxScore: 2, feedback: 'Independent evidence supplied.', criteria: [{ criterion: 'Independent evidence', awarded: 2, max: 2, comment: 'Supported.' }] }], strengths: ['Comparison'], gaps: [], nextSteps: ['Try another source'], helpSummary: 'Clarification used; no point penalty.' } }];
    data.assessments.push(a);
    data.assessments.push({ ...structuredClone(a), id: 'assessment-other', title: 'Other attempt', submissions: [{ ...structuredClone(a.submissions[0]), answer: 'Other original answer.' }] });
  });
  return { store: () => store, workspace: () => workspace, service: () => service,
    chat: async () => { await service.chat({ id: randomUUID(), message: 'Find my assessment evidence.' }); await service.settle(); },
    restart: async () => { service.stop(); await service.settle(); store.close(); store = new StateStore(dbPath); workspace = new PersonalizationWorkspace(store, join(dir, 'workspace')); service = new LearningService(store, provider, workspace); await service.recover(); await service.settle(); },
    close: async () => { service.stop(); await service.settle(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}
const response = (value: unknown) => ({ output: [], text: JSON.stringify(value), inputTokens: 100 });

test('assessment memory review is idempotent, receives only frozen evidence, uses flexible logged workspace tools and queues a discreet message', async () => {
  const requests: LearningAgentRequest[] = [];
  const f = await fixture(async request => {
    requests.push(request);
    assert.equal(request.ephemeral, true); assert.ok(request.tools.some(t => t.name === 'workspace_move'));
    const payload = JSON.parse((request.input[0] as { content: string }).content);
    assert.match(payload.evidence.submission.answer, /Original answer/);
    assert.equal(payload.evidence.messages.length, 2); assert.equal(payload.evidence.snapshotIds.length, 1);
    assert.doesNotMatch(JSON.stringify(payload.evidence), /Later teaching|Later mutable answer|later-page/);
    assert.match(request.instructions, /later teaching is excluded/i);
    const user = await request.executeTool('workspace_read', { path: 'USER.md' }, 'read-user') as { hash: string; content: string };
    const saved = await request.executeTool('workspace_write', { path: 'USER.md', expectedHash: user.hash, content: `${user.content}\nExplicit preference from assessment: diagrams.` }, 'save-user');
    assert.deepEqual(await request.executeTool('workspace_write', { path: 'USER.md', expectedHash: user.hash, content: `${user.content}\nExplicit preference from assessment: diagrams.` }, 'save-user'), saved);
    await request.executeTool('workspace_write', { path: 'memories/source-evaluation.md', expectedHash: null, content: `Evidence ${payload.evidence.id}: independently compared sources; one clarification used. This single score does not establish mastery.` }, 'save-memory');
    assert.match(await request.refreshInstructions!(), /Explicit preference from assessment: diagrams/);
    const photos = await request.executeTool('fetch_saved_work', { evidenceId: payload.evidence.id, photoIndices: [0] }, 'photo') as { images: string[] };
    assert.deepEqual(photos.images, [image]);
    assert.ok((await request.executeTool('fetch_saved_work', { evidenceId: payload.evidence.id, photoIndices: [1] }, 'later-photo') as { error: string }).error);
    const otherEvidenceId = `submission:${createHash('sha256').update(JSON.stringify(['assessment-other', 'revision'])).digest('hex').slice(0, 40)}`;
    assert.ok((await request.executeTool('fetch_saved_work', { evidenceId: otherEvidenceId, photoIndices: [0] }, 'other-attempt-photo') as { error: string }).error);
    assert.ok((await request.executeTool('search_history', {}, 'unavailable-background-tool') as { error: string }).error);
    return response({ message: 'I recorded your preference for diagrams. We can compare another source next.' });
  });
  try {
    await f.service().reviewAssessment('assessment-one', 'revision'); await f.service().reviewAssessment('assessment-one', 'revision'); await f.service().settle();
    assert.equal(requests.length, 1); let data = await f.store().readLearning();
    assert.equal(data.runs.filter(r => r.assessmentId === 'assessment-one').length, 1);
    assert.equal(data.reviewedEvidenceIds.length, 1); assert.equal(data.events.filter(e => e.name === 'workspace_write' && e.type === 'tool_result').length, 2);
    assert.equal((await f.workspace().revisions('USER.md')).length, 2);
    const pending = data.messages.find(m => m.proactive)!; assert.equal(pending.deliveredAt, undefined);
    assert.equal((await f.service().view()).messages.some(m => m.id === pending.id), false);
    await f.service().idle(); data = await f.store().readLearning(); assert.ok(data.messages.find(m => m.id === pending.id)?.deliveredAt);
    await f.service().reviewAssessment('assessment-one', 'revision'); await f.service().settle(); assert.equal(requests.length, 1);
  } finally { await f.close(); }
});

test('restart discovers completed submissions and does not repeat completed memory reviews across identical revision IDs', async () => {
  const evidenceIds: string[] = [];
  const f = await fixture(async request => { const payload = JSON.parse((request.input[0] as { content: string }).content); evidenceIds.push(payload.evidence.id); return response({ message: '' }); });
  try {
    await f.restart(); assert.equal(evidenceIds.length, 2); assert.equal(new Set(evidenceIds).size, 2);
    let data = await f.store().readLearning(); assert.equal(data.runs.filter(r => r.kind === 'review').length, 2); assert.equal(data.reviewedEvidenceIds.length, 2);
    await f.restart(); assert.equal(evidenceIds.length, 2); data = await f.store().readLearning(); assert.equal(data.runs.filter(r => r.kind === 'review').length, 2);
  } finally { await f.close(); }
});

test('main history retrieves individual frozen assessment submissions and owns each requested photo', async () => {
  const f = await fixture(async request => {
    assert.match(request.instructions, /Assessments section/); assert.match(request.instructions, /never grades/);
    const search = await request.executeTool('search_history', { curriculumId: ORIGINAL_CURRICULUM_ID, query: 'Evidence evaluation' }, 'search') as { items: { id: string; type: string; assessmentId: string }[] };
    assert.equal(search.items.length, 2);
    const submission = search.items.find(i => i.type === 'assessment_submission')!;
    const frozen = await request.executeTool('fetch_history', { id: submission.id }, 'fetch') as { submission: { answer: string }; messages: unknown[]; snapshotIds: string[] };
    assert.match(frozen.submission.answer, /Original answer/); assert.equal(frozen.messages.length, 2); assert.equal(frozen.snapshotIds.length, 1);
    assert.doesNotMatch(JSON.stringify(frozen), /Later teaching|Later mutable answer/);
    assert.deepEqual((await request.executeTool('fetch_saved_work', { evidenceId: submission.id, photoIndices: [0] }, 'photo') as { images: string[] }).images, [image]);
    assert.ok((await request.executeTool('fetch_saved_work', { evidenceId: submission.id, photoIndices: [1] }, 'bad-index') as { error: string }).error);
    assert.ok((await request.executeTool('fetch_saved_work', { evidenceId: frozen.snapshotIds[0], photoIndices: [0] }, 'raw-photo') as { error: string }).error);
    const root = search.items.find(i => i.type === 'assessment')!;
    const summary = await request.executeTool('fetch_history', { id: root.id }, 'root') as { submissions: { id: string }[]; messages?: unknown[] };
    assert.equal(summary.submissions[0].id, submission.id); assert.equal(summary.messages?.length, 3);
    const conversation = await request.executeTool('search_history', { query: 'independent means' }, 'search-conversation') as { items: { type: string }[] };
    assert.equal(conversation.items.filter(item => item.type === 'assessment').length, 2);
    const missing = await request.executeTool('search_history', { curriculumId: 'missing' }, 'foreign-curriculum') as { items: unknown[] }; assert.deepEqual(missing.items, []);
    return { output: [{ role: 'assistant', content: 'Saved evidence found.' }], text: 'Saved evidence found.', inputTokens: 100 };
  });
  try { await f.chat(); assert.equal((await f.store().readLearning()).runs.find(r => r.kind === 'chat')?.status, 'complete'); }
  finally { await f.close(); }
});

test('failed background reviews remain durable and retry through idle with logged workspace results', async () => {
  let calls = 0;
  const f = await fixture(async request => { calls++; await request.executeTool('workspace_list', {}, 'list'); if (calls === 1) throw new Error('synthetic interrupted review'); return response({ message: '' }); });
  try {
    await f.service().reviewAssessment('assessment-one', 'revision'); await f.service().settle();
    assert.equal((await f.store().readLearning()).runs[0].status, 'failed');
    await f.service().idle(); await f.service().settle(); const data = await f.store().readLearning();
    assert.equal(data.runs.length, 1); assert.equal(data.runs[0].status, 'complete'); assert.equal(data.reviewedEvidenceIds.length, 1);
    assert.equal(data.events.filter(e => e.name === 'workspace_list' && e.type === 'tool_result').length, 1);
  } finally { await f.close(); }
});
