import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore, ORIGINAL_CURRICULUM_ID } from '../server/state.js';
import { LearningService } from '../server/learning-service.js';
import { PersonalizationWorkspace } from '../server/personalization.js';
import { AssessmentError, AssessmentService } from '../server/assessment-service.js';
import type { LearningAgentRequest } from '../server/learning-provider.js';
import { fixtureLearningProvider } from './fixtures/learning.js';
import type { AssessmentProblem } from '../shared/assessments.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
const denied = (error: unknown) => error instanceof AssessmentError && error.status === 409;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ari-assessments-'));
  const dbPath = join(dir, 'state.sqlite');
  let store = new StateStore(dbPath);
  const calls: LearningAgentRequest[] = [];
  let failStage = '', unreadable = false, invalidPaper = false, invalidReview = false;
  let gate: Promise<void> | undefined;
  let lessonId = (await store.readLearning()).lessons[0].id;
  const paper: AssessmentProblem[] = [1, 2, 3].map(i => ({ id: `problem-${i}`, title: `Reason ${i}`, prompt: 'Explain why one plus one equals two.', lessonIds: [lessonId], points: 2, rubric: [{ criterion: 'Valid reasoning', points: 2 }], solution: 'Combine one object with one other object to obtain two objects.' }));
  const provider = fixtureLearningProvider(async request => {
    calls.push(request);
    const stage = request.instructions.includes('Propose a short') ? 'plan' : request.instructions.includes('Create a fresh') ? 'prepare' : request.instructions.includes('Independently solve') ? 'verify' : request.instructions.includes('Respond conversationally') ? 'chat' : 'grade';
    if (gate) await gate;
    if (failStage === stage) throw new Error('fixture provider failure with private internals');
    const result = stage === 'plan' ? { title: 'Mixed reasoning', lessonIds: [lessonId], minutes: 20, scopeReason: 'Practise the ready topic.' }
      : stage === 'prepare' ? { problems: paper }
      : stage === 'verify' ? { valid: !invalidPaper, reason: 'Checked independently.' }
      : stage === 'chat' ? { content: 'Try counting the two groups separately.', help: 'hint', problemIds: [paper[0].id] }
      : { evidence: unreadable ? 'unreadable' : 'readable', review: { summary: 'Your reasoning is clear.', score: invalidReview ? 7 : 6, maxScore: 6, problems: paper.map(p => ({ problemId: p.id, score: 2, maxScore: 2, feedback: 'A valid explanation.', criteria: [{ criterion: 'Valid reasoning', awarded: 2, max: 2, comment: 'Supported by your explanation.' }] })), strengths: ['Explains the reasoning'], gaps: [], nextSteps: ['Try larger groups'], helpSummary: 'A hint was provided; no point penalty.' } };
    return { output: [], text: JSON.stringify(result), inputTokens: 100 };
  });
  let workspace = new PersonalizationWorkspace(store, join(dir, 'workspace'));
  let service = new AssessmentService(store, new LearningService(store, provider, workspace));
  return { calls, paper, store: () => store, service: () => service,
    fail: (stage: string) => { failStage = stage; }, unreadable: () => { unreadable = true; }, invalidPaper: () => { invalidPaper = true; }, invalidReview: () => { invalidReview = true; }, gate: (promise?: Promise<void>) => { gate = promise; },
    active: async (id = 'assessment-1') => { await service.create({ id, curriculumId: ORIGINAL_CURRICULUM_ID }); await service.settle(); await service.prepare(id); await service.settle(); return service.view(id); },
    restart: async () => { service.stop(); await service.settle(); store.close(); store = new StateStore(dbPath); workspace = new PersonalizationWorkspace(store, join(dir, 'workspace')); service = new AssessmentService(store, new LearningService(store, provider, workspace)); await service.recover(); },
    close: async () => { service.stop(); await service.settle(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('assessment planning is deliberate and idempotent; preparation independently verifies a fresh paper and hides private rubric', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service().create({ id: 'bad', curriculumId: 'missing' }), e => e instanceof AssessmentError && e.status === 404);
    await f.service().create({ id: 'one', curriculumId: ORIGINAL_CURRICULUM_ID, minutes: 15 });
    await f.service().create({ id: 'one', curriculumId: ORIGINAL_CURRICULUM_ID, minutes: 15 });
    await f.service().settle();
    assert.equal(f.calls.length, 1); assert.equal((await f.service().view('one')).status, 'proposed');
    await assert.rejects(f.service().create({ id: 'one', curriculumId: ORIGINAL_CURRICULUM_ID, minutes: 30 }), denied);
    await assert.rejects(f.service().patch('one', { lessonIds: ['missing'] }), e => e instanceof AssessmentError && e.status === 400);
    await f.service().patch('one', { minutes: 10, instructions: 'Focus on explanations.' });
    await f.service().prepare('one'); await f.service().settle();
    const view = await f.service().view('one');
    assert.equal(view.status, 'active'); assert.equal(view.problems.length, 3);
    assert.equal('solution' in view.problems[0], false); assert.equal('rubric' in view.problems[0], false);
    assert.equal(f.calls.length, 3); assert.ok(f.calls[2].instructions.includes('Independently solve'));
    assert.ok(f.calls.every(c => c.ephemeral && c.instructions.includes('<TUTOR.md>')));
    assert.ok(f.calls.every(c => c.tools.some(t => t.name === 'workspace_read')));
    await f.service().pause('one'); await assert.rejects(f.service().chat('one', { id: 'm', message: 'Help' }), denied); await f.service().resume('one');
    assert.equal((await f.service().view('one')).status, 'active');
  } finally { await f.close(); }
});

test('chat attaches actual images, persists help and never grades; reload retries saved failed chat without another image', async () => {
  const f = await fixture();
  try {
    await f.active(); f.fail('chat');
    await f.service().chat('assessment-1', { id: 'message-1', message: 'A small hint please.', image }); await f.service().settle();
    assert.equal((await f.service().view('assessment-1')).messages.at(-1)?.status, 'failed');
    assert.equal((await f.service().view('assessment-1')).submissions.length, 0);
    await f.restart(); f.fail('');
    await f.service().retryChat('assessment-1', 'message-1'); await f.service().settle();
    const view = await f.service().view('assessment-1');
    assert.equal(view.messages.length, 2); assert.equal(view.messages[1].help, 'hint');
    const input = f.calls.at(-1)!.input as { content: { type: string; text?: string; image_url?: string }[] }[];
    assert.equal(input[0].content[1].type, 'input_image'); assert.equal(input[0].content[1].image_url, image);
    assert.equal(input[0].content[0].text?.includes('base64'), false);
    await f.service().chat('assessment-1', { id: 'message-1', message: 'A small hint please.', image }); await f.service().settle();
    assert.equal(view.messages.length, 2);
    await assert.rejects(f.service().chat('assessment-1', { id: 'message-1', message: 'Different text.' }), denied);
    await f.active('other');
    await assert.rejects(f.service().retryChat('other', 'message-1'), e => e instanceof AssessmentError && e.status === 404);
  } finally { await f.close(); }
});

test('submission freezes typed work, photos and chat; mutations are blocked while grading and revisions remain separate', async () => {
  const f = await fixture();
  try {
    await f.active(); await f.service().chat('assessment-1', { id: 'm', message: 'Please clarify.', image }); await f.service().settle();
    await f.service().addPage('assessment-1', { id: 'page', image });
    await f.service().patch('assessment-1', { answer: 'Two groups of one make two.' });
    let release!: () => void; f.gate(new Promise<void>(r => { release = r; }));
    let reviewed = 0; f.service().onReviewed = async () => { reviewed++; };
    await f.service().submit('assessment-1', { id: 's1', image });
    await f.service().submit('assessment-1', { id: 's1', image });
    await assert.rejects(f.service().patch('assessment-1', { answer: 'A newer answer' }), denied);
    await assert.rejects(f.service().removePage('assessment-1', 'page'), denied);
    await assert.rejects(f.service().submit('assessment-1', { id: 's2' }), denied);
    release(); f.gate(); await f.service().settle();
    let view = await f.service().view('assessment-1'); const first = structuredClone(view.submissions[0]);
    await f.service().resume('assessment-1'); assert.equal((await f.service().view('assessment-1')).status, 'active');
    assert.equal(first.snapshotIds.length, 1); assert.equal(first.messageIds.length, 2); assert.equal(first.answer, 'Two groups of one make two.'); assert.equal(first.review?.score, 6); assert.equal(reviewed, 1);
    await f.service().removePage('assessment-1', 'page'); await f.service().patch('assessment-1', { answer: 'Revised answer' });
    await f.service().chat('assessment-1', { id: 'later', message: 'Another thought.' }); await f.service().settle();
    await f.service().submit('assessment-1', { id: 's2' }); await f.service().settle();
    view = await f.service().view('assessment-1'); assert.deepEqual(view.submissions[0], first);
    assert.equal(view.submissions[1].snapshotIds.length, 0); assert.equal(view.submissions[1].answer, 'Revised answer'); assert.equal(view.submissions[1].messageIds.length, 4);
    assert.ok(f.store().getSnapshot(first.snapshotIds[0]));
    await assert.rejects(f.service().submit('assessment-1', { id: 's1', answer: 'Changed' }), denied);
    await f.restart(); assert.deepEqual((await f.service().view('assessment-1')).submissions[0], first);
  } finally { await f.close(); }
});

test('unreadable submission cannot receive invented scores, even when provider emits numeric grades', async () => {
  const f = await fixture();
  try {
    await f.active(); f.unreadable(); await f.service().submit('assessment-1', { id: 's', image }); await f.service().settle();
    const review = (await f.service().view('assessment-1')).submissions[0].review!;
    assert.equal(review.score, null); assert.ok(review.problems.every(p => p.score === null && p.criteria.length === 0));
  } finally { await f.close(); }
});

test('recovery marks interrupted operations retryable and saved grade retries create no duplicate submissions', async () => {
  const f = await fixture();
  try {
    await f.active(); f.fail('grade'); await f.service().submit('assessment-1', { id: 's', image, answer: 'My original answer.' }); await f.service().settle();
    let view = await f.service().view('assessment-1'); assert.equal(view.status, 'failed'); assert.equal(view.failureStage, 'grade'); assert.doesNotMatch(view.error!, /private internals/);
    await f.store().updateAssessments(data => { const a = data.assessments[0]; a.status = 'grading'; a.submissions[0].status = 'pending'; });
    await f.restart(); assert.equal((await f.service().view('assessment-1')).status, 'failed');
    f.fail(''); await f.service().retry('assessment-1'); await f.service().settle();
    view = await f.service().view('assessment-1'); assert.equal(view.status, 'reviewed'); assert.equal(view.submissions.length, 1); assert.equal(view.submissions[0].answer, 'My original answer.');
    const payload = JSON.parse((f.calls.at(-1)!.input[0] as { content: { text: string }[] }).content[0].text);
    assert.equal(payload.submission.answer, 'My original answer.');
    await f.store().updateAssessments(data => { data.assessments[0].status = 'planning'; });
    await f.restart(); assert.equal((await f.service().view('assessment-1')).failureStage, 'plan');
  } finally { await f.close(); }
});

test('invalid independent verification and inconsistent grade totals are retryable, never published as valid', async () => {
  const f = await fixture();
  try {
    f.invalidPaper(); const view = await f.active(); assert.equal(view.status, 'failed'); assert.equal(view.failureStage, 'prepare'); assert.equal(view.problems.length, 0);
  } finally { await f.close(); }
  const g = await fixture();
  try {
    await g.active(); g.invalidReview(); await g.service().submit('assessment-1', { id: 's', answer: 'An answer' }); await g.service().settle();
    const view = await g.service().view('assessment-1'); assert.equal(view.status, 'failed'); assert.equal(view.submissions[0].review, undefined);
  } finally { await g.close(); }
});

test('assessment state validation rolls back snapshots atomically and separates learners', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.store().updateAssessments(data => { f.store().saveSnapshot(image); data.assessments.push({ id: 'invalid' } as never); }));
    assert.equal((await f.store().readAssessments()).assessments.length, 0);
    await f.active(); const other = new StateStore(f.store().dbPath, { learnerId: 'other' });
    try { assert.deepEqual(await other.readAssessments(), { assessments: [] }); } finally { other.close(); }
  } finally { await f.close(); }
});

test('failed planning and preparation retry from saved scope without adding assessments or exposing unfinished papers', async () => {
  const f = await fixture();
  try {
    f.fail('plan'); await f.service().create({ id: 'retry', curriculumId: ORIGINAL_CURRICULUM_ID, minutes: 15 }); await f.service().settle();
    assert.equal((await f.service().view('retry')).failureStage, 'plan');
    f.fail(''); await f.service().retry('retry'); await f.service().settle();
    assert.equal((await f.service().view('retry')).status, 'proposed');
    await f.service().patch('retry', { instructions: 'Explain each step.' });
    f.fail('prepare'); await f.service().prepare('retry'); await f.service().settle();
    let view = await f.service().view('retry'); assert.equal(view.failureStage, 'prepare'); assert.equal(view.problems.length, 0);
    await f.restart(); f.fail(''); await f.service().retry('retry'); await f.service().settle();
    view = await f.service().view('retry'); assert.equal(view.status, 'active'); assert.equal(view.instructions, 'Explain each step.'); assert.equal(view.minutes, 15);
    assert.equal((await f.service().list()).assessments.length, 1);
  } finally { await f.close(); }
});

test('submission adds the current page once and subsequent chat can discuss its saved review without grading again', async () => {
  const f = await fixture();
  try {
    await f.active();
    await assert.rejects(f.service().submit('assessment-1', { id: 'empty' }), e => e instanceof AssessmentError && e.status === 400);
    await f.service().submit('assessment-1', { id: 'first', image }); await f.service().settle();
    const first = await f.service().view('assessment-1');
    assert.equal(first.pages.length, 1);
    assert.deepEqual(first.submissions[0].snapshotIds, [first.pages[0].snapshotId]);
    await f.service().chat('assessment-1', { id: 'review-question', message: 'Why did you give that feedback?' }); await f.service().settle();
    const payload = JSON.parse((f.calls.at(-1)!.input[0] as { content: { text: string }[] }).content[0].text);
    assert.deepEqual(payload.reviews[0].review, first.submissions[0].review);
    assert.equal((await f.service().view('assessment-1')).submissions.length, 1);
    await f.service().resume('assessment-1');
    await f.service().submit('assessment-1', { id: 'second', image }); await f.service().settle();
    assert.equal((await f.service().view('assessment-1')).pages.length, 1);
  } finally { await f.close(); }
});

test('chat atomically captures typed work and preserves its evidence on retry after draft and page edits', async () => {
  const f = await fixture();
  try {
    await f.active(); await f.service().addPage('assessment-1', { id: 'saved', image });
    f.fail('chat');
    await f.service().chat('assessment-1', { id: 'typed-question', message: 'Is my reasoning right?', answer: 'Fresh reasoning typed just before Send.' }); await f.service().settle();
    const before = await f.service().view('assessment-1');
    assert.equal(before.answer, 'Fresh reasoning typed just before Send.');
    await f.service().patch('assessment-1', { answer: 'A later unrelated draft.' });
    await f.service().removePage('assessment-1', 'saved');
    f.fail(''); await f.service().retryChat('assessment-1', 'typed-question'); await f.service().settle();
    const input = (f.calls.at(-1)!.input[0] as { content: { type: string; text?: string; image_url?: string }[] }).content;
    assert.equal(JSON.parse(input[0].text!).typedDraft, 'Fresh reasoning typed just before Send.');
    assert.ok(input.some(part => part.type === 'input_image' && part.image_url === image));
    await f.service().submit('assessment-1', { id: 'reviewed-photo', image }); await f.service().settle();
    const withReview = await f.service().view('assessment-1');
    await f.service().removePage('assessment-1', withReview.pages[0].id);
    await f.service().chat('assessment-1', { id: 'old-review', message: 'Explain the feedback on my submitted photo.' }); await f.service().settle();
    const followup = (f.calls.at(-1)!.input[0] as { content: { type: string; image_url?: string }[] }).content;
    assert.ok(followup.some(part => part.type === 'input_image' && part.image_url === image));
  } finally { await f.close(); }
});
