import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { StateStore } from '../server/state.js';
import { LearningService } from '../server/learning-service.js';
import { LearningProviderError, type LearningAgentProvider } from '../server/learning-provider.js';
import type { AIAsk } from '../server/ai.js';
import { exercises } from '../shared/curriculum.js';
import { fixtureLearningProvider, historyProposal, preparedLesson, toolReply } from './fixtures/learning.js';

async function fixture(provider?: LearningAgentProvider, ai?: AIAsk) {
  const dir = await mkdtemp(join(tmpdir(), 'ari-learning-'));
  const options = { dbPath: join(dir, 'state.sqlite'), legacyStatePath: join(dir, 'none.json'), learningProvider: provider, learningConfigured: Boolean(provider), ai, aiConfigured: Boolean(ai) };
  let app = createApp(options); let server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const stop = async () => { app.locals.learning.stop(); await app.locals.learning.settle(); await new Promise<void>(resolve => server.close(() => resolve())); app.locals.store.close(); };
  return { request, store: () => app.locals.store as StateStore, service: () => app.locals.learning as LearningService, settle: async () => { await new Promise(resolve => setImmediate(resolve)); await app.locals.learning.settle(); },
    restart: async () => { await stop(); app = createApp(options); server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); await app.locals.learning.settle(); },
    close: async () => { await stop(); await rm(dir, { recursive: true, force: true }); } };
}
const chat = (fx: Awaited<ReturnType<typeof fixture>>, message: string, id = randomUUID()) => fx.request('/api/learning/chat', 'POST', { id, message });
const proposeProvider = () => fixtureLearningProvider(request => toolReply(request, 'propose_learning', historyProposal));

test('casual exploration creates nothing; duplicate sends and reload preserve one turn', async () => {
  let runs = 0; const base = fixtureLearningProvider();
  const fx = await fixture({ ...base, run: async r => { runs++; return base.run(r); } });
  try {
    const id = randomUUID(); const first = await (await chat(fx, 'Why did Rome grow?', id)).json();
    assert.equal((await chat(fx, 'Why did Rome grow?', id)).status, 202); await fx.settle();
    let view = await (await fx.request('/api/learning')).json(); assert.equal(view.curricula.length, 1); assert.equal(view.proposals.length, 0); assert.equal(view.messages.length, 2); assert.equal(view.runs[0].status, 'complete'); assert.equal(view.runs[0].context, undefined);
    assert.equal(runs, 1); assert.equal((await chat(fx, 'A different request', id)).status, 409);
    await fx.restart(); assert.equal((await (await chat(fx, 'Why did Rome grow?', id)).json()).runId, first.runId); await fx.settle();
    view = await (await fx.request('/api/learning')).json(); assert.equal(view.messages.length, 2); assert.equal(runs, 1); assert.equal((await fx.store().readLearning()).context.length, 2);
  } finally { await fx.close(); }
});

test('explicit acceptance creates exactly one generic curriculum and prepares only its first lesson', async () => {
  const ai: AIAsk = async () => ({ kind: 'explanation', observation: '', feedback: 'Consider the author’s purpose.', nextStep: 'Read the claim closely.', question: '', score: null, criteria: [], readable: false, confidence: 'medium', workRelevant: false, workLegible: false });
  const fx = await fixture(proposeProvider(), ai);
  try {
    await chat(fx, 'Propose a path to reading history.'); await fx.settle();
    const before = await fx.store().readLearning(); assert.equal(before.curricula.length, 1); assert.equal(before.proposals.length, 1);
    const p = before.proposals[0]; assert.equal((await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: 999 })).status, 409);
    const accepted = await (await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision })).json();
    const duplicate = await (await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision })).json(); assert.equal(accepted.runId, duplicate.runId); await fx.settle();
    const d = await fx.store().readLearning(); assert.equal(d.curricula.length, 2);
    const c = d.curricula.find(c => c.id === accepted.curriculumId)!; const lessons = d.lessons.filter(l => l.curriculumId === c.id);
    assert.deepEqual(lessons.map(l => l.status), ['ready', 'planned']); assert.equal(lessons[0].subject, 'history'); assert.equal(lessons[0].exerciseIds.length, 2); assert.equal(lessons[1].exerciseIds.length, 0);
    const state = await (await fx.request('/api/state')).json(); const e = d.exercises.find(e => e.moduleId === lessons[0].id)!; assert.ok(state.generatedExercises.some((x: {id:string}) => x.id === e.id));
    assert.equal((await fx.request('/api/lesson-chat', 'POST', { id: randomUUID(), moduleId: lessons[0].id, message: 'What counts as evidence?' })).status, 200);
    assert.equal((await fx.request('/api/tutor', 'POST', { exerciseId: e.id, mode: 'chat', message: 'Can I compare two accounts?' })).status, 200);
    assert.equal(d.runs.find(r => r.id === accepted.runId)?.status, 'complete'); assert.ok(d.events.some(e => e.type === 'tool_result' && e.name === 'propose_learning'));
    await fx.restart(); assert.equal((await fx.store().readLearning()).curricula.length, 2);
  } finally { await fx.close(); }
});

test('failed content validation is recoverable without duplicate curriculum or exercises', async () => {
  let invalid = true; const base = proposeProvider();
  const fx = await fixture({ ...base, generate: async <T>(instruction: string) => (instruction.startsWith('Independently') ? { valid: true, reason: '' } : { ...preparedLesson, exercises: invalid ? [preparedLesson.exercises[0]] : preparedLesson.exercises }) as T });
  try {
    await chat(fx, 'Prepare a history path.'); await fx.settle(); let d = await fx.store().readLearning(); const p = d.proposals[0];
    await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision }); await fx.settle(); d = await fx.store().readLearning();
    assert.equal(d.runs.find(r => r.kind === 'prepare')?.status, 'failed'); assert.equal(d.lessons.find(l => l.curriculumId !== 'original-prepa')?.status, 'failed');
    invalid = false; await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision }); await fx.settle(); d = await fx.store().readLearning();
    assert.equal(d.curricula.length, 2); assert.equal(d.exercises.filter(e => e.generated).length, 2); assert.equal(d.runs.filter(r => r.kind === 'prepare').length, 1);
  } finally { await fx.close(); }
});

test('failed provider response keeps message and checkpoint; latest retry resumes once and secrets stay private', async () => {
  let fail = true, seenUsers = 0; const provider = fixtureLearningProvider(async request => {
    seenUsers = request.input.filter(i => (i as {role?:string}).role === 'user').length;
    await request.onCheckpoint?.([...request.input, { type: 'reasoning', encrypted_content: 'opaque' }], 30);
    if (fail) throw new LearningProviderError('API_CREDITS', 'OpenAI API credits are exhausted. Add credits, then retry this message.');
    return { output: [{ role: 'assistant', content: 'Recovered.' }], text: 'Recovered.', inputTokens: 50 };
  });
  const fx = await fixture(provider);
  try {
    const id = randomUUID(); await chat(fx, 'Tell me about history.', id); await fx.settle(); let d = await fx.store().readLearning(); assert.equal(d.runs[0].status, 'failed'); assert.match(d.runs[0].error!, /credits/); assert.ok(d.runs[0].context);
    fail = false; await chat(fx, 'Tell me about history.', id); await fx.settle(); d = await fx.store().readLearning(); assert.equal(d.runs[0].status, 'complete'); assert.equal(seenUsers, 1); assert.equal(d.messages.length, 2); assert.equal(d.runs[0].context, undefined);
  } finally { await fx.close(); }
});

test('retrying an older failed turn cannot discard a newer completed conversation', async () => {
  let fail = true; const base = fixtureLearningProvider(); const fx = await fixture({ ...base, run: async r => { if (fail) throw new Error('private-secret-key'); return base.run(r); } });
  try { const old = randomUUID(); await chat(fx, 'Earlier failed question', old); await fx.settle(); fail = false; await chat(fx, 'A newer question'); await fx.settle();
    const context = (await fx.store().readLearning()).context; assert.equal((await chat(fx, 'Earlier failed question', old)).status, 409); assert.deepEqual((await fx.store().readLearning()).context, context);
    assert.ok(!JSON.stringify(await (await fx.request('/api/learning')).json()).includes('private-secret-key'));
  } finally { await fx.close(); }
});

test('actual provider compaction output is preserved independently of the full transcript', async () => {
  const original = process.env.LEARNING_COMPACTION_TOKENS; process.env.LEARNING_COMPACTION_TOKENS = '1'; let compacted = 0; const base = fixtureLearningProvider();
  const fx = await fixture({ ...base, compact: async (input, instructions) => { compacted++; assert.match(instructions, /Ari/); return [{ type: 'compaction', encrypted_content: 'canonical-opaque' }, { role: 'user', content: 'retained' }]; } });
  try { await chat(fx, 'First'); await fx.settle(); await chat(fx, 'Second'); await fx.settle(); const d = await fx.store().readLearning(); assert.equal(compacted, 1); assert.equal(d.messages.length, 4); assert.deepEqual(d.context[0], { type: 'compaction', encrypted_content: 'canonical-opaque' }); assert.ok(d.compactedAt); assert.ok(d.events.some(e => e.type === 'compaction'));
  } finally { if (original === undefined) delete process.env.LEARNING_COMPACTION_TOKENS; else process.env.LEARNING_COMPACTION_TOKENS = original; await fx.close(); }
});

test('reflection analysis preserves user corrections, delivers at idle once and adds context', async () => {
  let release!: () => void; let begun!: () => void; const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => begun = resolve);
  const provider = fixtureLearningProvider(undefined, async <T>() => { begun(); await gate; return { message: 'Compare an independent source next time.', memory: 'Stale inferred notes' } as T; });
  const fx = await fixture(provider);
  try { const saved = await fx.request('/api/reflections', 'POST', { exerciseId: exercises[0].id, confidence: 3, notes: 'The comparison was difficult.' }); assert.equal(saved.status, 201); await started;
    const before = (await fx.service().view()).memory; const patch = await fx.request('/api/learning/memory', 'PATCH', { revision: before.revision, content: 'User correction: I understand comparison but need vocabulary.' }); assert.equal(patch.status, 200);
    assert.equal((await fx.request('/api/learning/memory', 'PATCH', { revision: before.revision, content: 'Old revision' })).status, 409);
    release(); await fx.settle(); let d = await fx.store().readLearning(); assert.match((await fx.service().view()).memory.content, /User correction/); assert.equal((await (await fx.request('/api/learning')).json()).messages.filter((m: {proactive?: boolean}) => m.proactive).length, 0);
    assert.equal((await (await fx.request('/api/learning/idle', 'POST', {})).json()).delivered, 1); assert.equal((await (await fx.request('/api/learning/idle', 'POST', {})).json()).delivered, 0);
    d = await fx.store().readLearning(); assert.ok(d.context.some(i => (i as {content?:string}).content === 'Compare an independent source next time.')); assert.equal(d.messages.filter(m => m.proactive).length, 1);
    assert.equal((await (await fx.request('/api/learning')).json()).unreadCount, 1); await fx.request('/api/learning/read', 'POST', {}); assert.equal((await (await fx.request('/api/learning')).json()).unreadCount, 0);
  } finally { release(); await fx.close(); }
});

test('recovery discovers a reflection saved before its analysis could be queued', async () => {
  const fx = await fixture(fixtureLearningProvider());
  try { const id = randomUUID(); await fx.store().update(s => { s.reflections.push({ id, exerciseId: exercises[0].id, createdAt: new Date().toISOString(), confidence: 2, notes: 'A reflection surviving a crash.' }); });
    await fx.restart(); await fx.settle(); const d = await fx.store().readLearning(); assert.ok(d.reviewedEvidenceIds.includes(id)); assert.equal(d.runs.filter(r => r.requestId === id).length, 1); await fx.restart(); assert.equal((await fx.store().readLearning()).messages.filter(m => m.proactive).length, 1);
  } finally { await fx.close(); }
});

test('tool retries replay accepted side effects and missing evidence returns tool errors', async () => {
  let toolError: unknown; const fx = await fixture(fixtureLearningProvider(async r => {
    const p1 = await r.executeTool('propose_learning', historyProposal, 'stable-proposal'); const p2 = await r.executeTool('propose_learning', historyProposal, 'stable-proposal'); assert.deepEqual(p1, p2);
    toolError = await r.executeTool('fetch_saved_work', { evidenceId: 'missing', photoIndices: [0] }, 'missing-photo');
    return { output: [{role:'assistant',content:'Outline.'}], text: 'Outline.', inputTokens: 50 };
  }));
  try { await chat(fx, 'History proposal'); await fx.settle(); const d = await fx.store().readLearning(); assert.equal(d.proposals.length, 1); assert.equal(d.events.filter(e => e.type === 'tool_result' && e.callId === 'stable-proposal').length, 1); assert.match(JSON.stringify(toolError), /not found/); assert.equal(d.runs[0].status, 'complete'); }
  finally { await fx.close(); }
});

test('preparation uses proposal-selected materials and never unrelated uploaded notes', async () => {
  let selected = ''; let prepPayload: unknown; const base = fixtureLearningProvider();
  const fx = await fixture({ ...base, run: r => toolReply(r, 'propose_learning', { ...historyProposal, materialIds: [selected] }), generate: async <T>(instruction: string, payload: unknown, schema: Record<string, unknown>) => { if (instruction.startsWith('Prepare')) prepPayload = payload; return base.generate<T>(instruction, payload, schema); } });
  try { const source = await (await fx.request('/api/learning/materials', 'POST', { title: 'Relevant source', kind: 'note', text: 'A mayor claims a park helps health.' })).json(); selected = source.id;
    await fx.request('/api/learning/materials', 'POST', { title: 'Private unrelated interest', kind: 'note', text: 'A completely different personal topic.' });
    const view = await (await fx.request('/api/learning')).json(); assert.equal(view.materials[0].text, undefined); assert.equal((await fx.request(`/api/learning/materials/${selected}/source`)).status, 200);
    await chat(fx, 'Use the relevant source.'); await fx.settle(); const p = (await fx.store().readLearning()).proposals[0]; await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision }); await fx.settle();
    assert.ok(JSON.stringify(prepPayload).includes('A mayor claims')); assert.ok(!JSON.stringify(prepPayload).includes('completely different personal topic')); assert.equal((await fx.request('/api/learning/materials', 'POST', { title:'private',kind:'link',url:'http://127.0.0.1/admin' })).status, 400);
  } finally { await fx.close(); }
});

test('preparing later lessons uses current curriculum evidence; accepted enrichment versions content without changing old work', async () => {
  let expand = false, curriculumId = '', lessonId = '', prepPayload: unknown; const base = fixtureLearningProvider();
  const fx = await fixture({ ...base, run: request => toolReply(request, 'propose_learning', expand ? { ...historyProposal, kind: 'expand', targetCurriculumId: curriculumId, targetLessonId: lessonId, expansion: 'enrich', lessons: [historyProposal.lessons[0]] } : historyProposal, randomUUID()),
    generate: async <T>(instructions: string, payload: unknown, schema: Record<string, unknown>) => { if (instructions.startsWith('Prepare')) prepPayload = payload; return base.generate<T>(instructions, payload, schema); } });
  try { await chat(fx, 'History path'); await fx.settle(); let d = await fx.store().readLearning(); let p = d.proposals[0]; await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision }); await fx.settle();
    d = await fx.store().readLearning(); curriculumId = d.proposals[0].curriculumId!; const c = d.curricula.find(c => c.id === curriculumId)!; lessonId = c.lessonIds[0]; const first = d.lessons.find(l => l.id === lessonId)!;
    const oldExercises = structuredClone(d.exercises.filter(e => e.moduleId === lessonId)); const oldLesson = structuredClone(first);
    await fx.request(`/api/progress/${oldExercises[0].id}`, 'PUT', { status: 'completed', confidence: 3 });
    await fx.request(`/api/learning/lessons/${c.lessonIds[1]}/prepare`, 'POST', {}); await fx.settle(); assert.ok(JSON.stringify(prepPayload).includes(oldExercises[0].id));
    expand = true; await chat(fx, 'Enrich the first lesson'); await fx.settle(); d = await fx.store().readLearning(); p = d.proposals.at(-1)!;
    assert.equal(d.lessons.find(l => l.id === lessonId)?.exerciseIds.length, 2);
    await fx.request(`/api/learning/proposals/${p.id}/accept`, 'POST', { revision: p.revision }); await fx.settle(); d = await fx.store().readLearning();
    assert.equal(d.curricula.length, 2); assert.equal(d.lessons.find(l => l.id === lessonId)?.exerciseIds.length, 4); assert.deepEqual(d.exercises.filter(e => oldExercises.some(old => old.id === e.id)), oldExercises);
    const history = await fx.store().readLessonRevisions(lessonId); assert.ok(history.some(r => r.lesson.revision === oldLesson.revision && r.lesson.primer === oldLesson.primer));
    assert.equal((await fx.store().read()).progress[oldExercises[0].id].status, 'completed'); await fx.restart(); assert.equal((await fx.store().readLearning()).lessons.find(l => l.id === lessonId)?.exerciseIds.length, 4);
  } finally { await fx.close(); }
});

test('a queued server-owned chat survives restart and replays durable tool results by call ID', async () => {
  let calls = 0; const fx = await fixture(fixtureLearningProvider(async request => { calls++; const previous = await request.executeTool('propose_learning', historyProposal, 'crash-call'); assert.ok(previous); return { output:[{role:'assistant',content:'Recovered proposal.'}],text:'Recovered proposal.',inputTokens:80 }; }));
  try { fx.service().stop(); const requestId = randomUUID(); await chat(fx, 'A durable pending request', requestId);
    const d = await fx.store().readLearning(), run = d.runs[0]; const proposal = { ...historyProposal, id: randomUUID(), status: 'proposed' as const, createdAt: new Date().toISOString(), revision: 1 };
    await fx.store().updateLearning(s => { s.proposals.push(proposal); s.events.push({ id: randomUUID(), runId: run.id, type:'tool_result', name:'propose_learning',callId:'crash-call',createdAt:new Date().toISOString(),data:proposal }); const r = s.runs[0]; r.status='running';r.context=[{role:'user',content:'A durable pending request'},{type:'function_call',call_id:'crash-call',name:'propose_learning',arguments:JSON.stringify(historyProposal)}]; });
    await fx.restart(); await fx.settle(); const recovered = await fx.store().readLearning(); assert.equal(recovered.runs[0].status, 'complete'); assert.equal(recovered.proposals.length, 1); assert.equal(calls, 1);
  } finally { await fx.close(); }
});

test('a proactive delivery advances context and blocks an obsolete failed retry', async () => {
  const fx = await fixture(fixtureLearningProvider(async request => { await request.onCheckpoint?.(request.input, 30); throw new Error('unavailable'); }));
  try { const id = randomUUID(); await chat(fx, 'A question', id); await fx.settle(); await fx.store().updateLearning(s => { s.messages.push({ id:randomUUID(),role:'assistant',content:'A saved suggestion.',createdAt:new Date().toISOString(),status:'complete',proactive:true }); });
    await fx.request('/api/learning/idle', 'POST', {}); const context = (await fx.store().readLearning()).context; assert.equal((await chat(fx, 'A question', id)).status, 409); assert.deepEqual((await fx.store().readLearning()).context, context);
  } finally { await fx.close(); }
});

test('failed background analysis retries at an explicit idle boundary without duplicate evidence', async () => {
  let fail = true; const base = fixtureLearningProvider(); const fx = await fixture({ ...base, generate: async <T>(instructions: string, payload: unknown, schema: Record<string, unknown>) => { if (fail) throw new Error('offline'); return base.generate<T>(instructions, payload, schema); } });
  try { await fx.request('/api/reflections', 'POST', { exerciseId:exercises[0].id, confidence:2,notes:'Check this evidence.' }); await fx.settle(); assert.equal((await fx.store().readLearning()).runs[0].status,'failed');
    fail = false; await fx.request('/api/learning/idle','POST',{}); await fx.settle(); let d = await fx.store().readLearning(); assert.equal(d.runs.length,1);assert.equal(d.runs[0].status,'complete');assert.equal(d.reviewedEvidenceIds.length,1);
    await fx.request('/api/learning/idle','POST',{});await fx.settle();d=await fx.store().readLearning();assert.equal(d.messages.length,1);
  } finally { await fx.close(); }
});

test('current preferences override seeded notes and preparation receives the requested language', async () => {
  let mainInstructions = '', payload: unknown, prepInstructions = ''; const base = fixtureLearningProvider();
  const fx = await fixture({ ...base, run: request => { mainInstructions = request.instructions; return toolReply(request, 'propose_learning', historyProposal); }, generate: async <T>(instructions: string, value: unknown, schema: Record<string, unknown>) => { if (instructions.startsWith('Prepare')) { payload = value; prepInstructions = instructions; } return base.generate<T>(instructions, value, schema); } });
  try { await fx.request('/api/profile','PATCH',{ language:'fr',goal:'Read historical sources in French.' }); await chat(fx,'A French history course'); await fx.settle(); assert.match(mainInstructions,/"language":"fr"/); assert.match(mainInstructions,/take precedence/);
    const p = (await fx.store().readLearning()).proposals[0]; await fx.request(`/api/learning/proposals/${p.id}/accept`,'POST',{revision:p.revision});await fx.settle();assert.match(prepInstructions,/profile.language/);assert.equal((payload as {profile:{language:string}}).profile.language,'fr');
  } finally { await fx.close(); }
});

test('history retrieval includes practice generated after the SQLite learning migration', async () => {
  const legacyId = 'generated-after-v4'; let inspected: unknown, searched: unknown;
  const fx = await fixture(fixtureLearningProvider(async request => { inspected = await request.executeTool('inspect_learning',{lessonId:exercises[0].moduleId,limit:30},'inspect-legacy');searched=await request.executeTool('search_history',{curriculumId:'original-prepa',query:'fresh practice'},'history-legacy');return {output:[{role:'assistant',content:'Found your practice.'}],text:'Found your practice.',inputTokens:60}; }));
  try { await fx.store().update(s => {s.generatedExercises.push({...exercises[0],id:legacyId,generated:true});s.progress[legacyId]={exerciseId:legacyId,status:'completed',confidence:3,updatedAt:new Date().toISOString(),hintCount:0,lastScore:null,nextReviewAt:null};s.reflections.push({id:randomUUID(),exerciseId:legacyId,createdAt:new Date().toISOString(),confidence:3,notes:'fresh practice with new evidence'});});
    await chat(fx,'Fetch my recent practice');await fx.settle();assert.ok((inspected as {exercises:{id:string}[]}).exercises.some(e=>e.id===legacyId));assert.ok((inspected as {progress:{exerciseId:string}[]}).progress.some(p=>p.exerciseId===legacyId));assert.equal((searched as {items:unknown[]}).items.length,1);
  } finally {await fx.close();}
});

test('completed assistant preludes survive a compacted checkpoint and interrupted turn', async () => {
  let failed = false; let restoredText: string | undefined;
  const fx = await fixture(fixtureLearningProvider(async request => {
    if (!failed) {
      await request.onText?.('I have found the source.');
      await request.onCheckpoint?.([...request.input, {type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'I have found the source.',annotations:[]}]}], 100, 'I have found the source.');
      // A real compaction retains user messages plus its opaque item, folding
      // earlier assistant text away from the human-readable input window.
      await request.onCheckpoint?.([...request.input, {type:'compaction',encrypted_content:'opaque-completed-prelude'}], 30, 'I have found the source.');
      failed = true; throw new LearningProviderError('API_TIMEOUT','The connection was interrupted. Retry to continue.');
    }
    restoredText = request.resumeText;
    const text = `${request.resumeText}\n\nHere is what the source supports.`;
    const output = [{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Here is what the source supports.',annotations:[]}]}];
    await request.onCheckpoint?.([...request.input,...output],70,text);
    return {output,text,inputTokens:70,context:[...request.input,...output]};
  }));
  try { const id=randomUUID();await chat(fx,'Research this claim.',id);await fx.settle();let d=await fx.store().readLearning();assert.equal(d.runs[0].status,'failed');assert.equal(d.runs[0].completedText,'I have found the source.');assert.ok(!JSON.stringify(d.runs[0].context).includes('I have found the source.'));
    await fx.restart();await chat(fx,'Research this claim.',id);await fx.settle();d=await fx.store().readLearning();assert.equal(restoredText,'I have found the source.');assert.equal(d.messages[1].content,'I have found the source.\n\nHere is what the source supports.');assert.equal(d.runs[0].completedText,undefined);assert.equal(d.runs[0].status,'complete');
  } finally {await fx.close();}
});

test('lesson preparation repairs exact local-check feedback once before independent verification', async () => {
  let drafts = 0, verifications = 0; const repairPayloads: any[] = [];
  const badDraft = structuredClone(preparedLesson); badDraft.exercises[0].hints.pop(); badDraft.exercises[0].rubric[0].points = 4;
  const base = proposeProvider();
  const fx = await fixture({ ...base, generate: async <T>(instruction: string, payload: unknown) => {
    if (instruction.startsWith('Independently')) { verifications++; return { valid: true, reason: 'Correct and appropriate.' } as T; }
    drafts++; if (drafts === 2) repairPayloads.push(payload);
    return structuredClone(drafts === 1 ? badDraft : preparedLesson) as T;
  } });
  try {
    await chat(fx, 'Prepare a history lesson.'); await fx.settle(); const proposal = (await fx.store().readLearning()).proposals[0];
    await fx.request(`/api/learning/proposals/${proposal.id}/accept`, 'POST', { revision: proposal.revision }); await fx.settle();
    const data = await fx.store().readLearning(); const lesson = data.lessons.find(l => l.curriculumId !== 'original-prepa')!;
    assert.equal(lesson.status, 'ready'); assert.equal(data.exercises.filter(e => e.generated).length, 2);
    assert.equal(drafts, 2); assert.equal(verifications, 1);
    assert.deepEqual(repairPayloads[0].revision.priorDraft, badDraft);
    assert.match(repairPayloads[0].revision.feedback.join(' '), /exactly three progressive hints; received 2/);
    assert.match(repairPayloads[0].revision.feedback.join(' '), /total 10 points; received 9/);
    assert.equal(repairPayloads[0].curriculum.id, lesson.curriculumId); assert.ok(repairPayloads[0].profile.language);
  } finally { await fx.close(); }
});

test('independent lesson rejection feeds its precise reason into one revision and verifies the revised draft again', async () => {
  let drafts = 0, verifications = 0; let repairedPayload: any; const verified: any[] = []; const preparationPrompts: string[] = []; const verificationPrompts: string[] = [];
  const corrected = { ...preparedLesson, primer: preparedLesson.primer + ' Distinguish a causal claim from a correlation.' };
  const reason = 'The primer conflates a causal claim with correlation; explain the distinction before exercise 1.';
  const fx = await fixture({ ...proposeProvider(), generate: async <T>(instruction: string, payload: unknown) => {
    if (instruction.startsWith('Independently')) {
      verificationPrompts.push(instruction); verified.push(payload); verifications++; return { valid: verifications === 2, reason: verifications === 1 ? reason : 'Corrected.' } as T;
    }
    preparationPrompts.push(instruction); drafts++; if (drafts === 2) repairedPayload = payload;
    return structuredClone(drafts === 1 ? preparedLesson : corrected) as T;
  } });
  try {
    await chat(fx, 'Prepare a history path.'); await fx.settle(); const proposal = (await fx.store().readLearning()).proposals[0];
    await fx.request(`/api/learning/proposals/${proposal.id}/accept`, 'POST', { revision: proposal.revision }); await fx.settle();
    const data = await fx.store().readLearning(); const lesson = data.lessons.find(l => l.curriculumId !== 'original-prepa')!;
    assert.equal(lesson.status, 'ready'); assert.equal(lesson.primer, corrected.primer); assert.equal(drafts, 2); assert.equal(verifications, 2);
    assert.deepEqual(repairedPayload.revision.feedback, [reason]); assert.deepEqual(repairedPayload.revision.priorDraft, preparedLesson);
    assert.equal(verified[1].prepared.primer, corrected.primer); assert.equal(data.runs.filter(r => r.kind === 'prepare').length, 1);
    assert.ok(preparationPrompts.every(prompt => prompt.includes('Common introductory knowledge may be taught without citations') && prompt.includes('uncertain, specialized or current claims require appropriate grounding')));
    assert.ok(verificationPrompts.every(prompt => prompt.includes('do not reject common introductory knowledge solely because no sources were supplied')));
    assert.ok(preparationPrompts.every(prompt => prompt.includes('Graded exercises must be assessable from written answers, notation or a photo of written work') && prompt.includes('never award rubric points for unobservable performance')));
    assert.ok(preparationPrompts.every(prompt => prompt.includes('without giving the final answer or complete construction, either separately or collectively')));
    assert.ok(preparationPrompts.every(prompt => prompt.includes('Preserve any lesson duration explicitly accepted in the lesson, curriculum or proposal; it takes precedence over a generic session-duration preference')));
    assert.ok(verificationPrompts.every(prompt => prompt.includes('reject points for unobservable physical or audio performance, tapping or timing')));
  } finally { await fx.close(); }
});

test('a second independent rejection stops revision and saves a useful concise failure reason', async () => {
  let drafts = 0, verifications = 0;
  const fx = await fixture({ ...proposeProvider(), generate: async <T>(instruction: string) => {
    if (instruction.startsWith('Independently')) { verifications++; return { valid: false, reason: verifications === 1
      ? 'Exercise 1 does not provide the source it asks the learner to compare.'
      : 'Exercise 2 remains ambiguous: the prompt gives no dates for the claimed change.' } as T; }
    drafts++; return structuredClone(preparedLesson) as T;
  } });
  try {
    await chat(fx, 'Prepare a history path.'); await fx.settle(); const proposal = (await fx.store().readLearning()).proposals[0];
    await fx.request(`/api/learning/proposals/${proposal.id}/accept`, 'POST', { revision: proposal.revision }); await fx.settle();
    const data = await fx.store().readLearning(); const lesson = data.lessons.find(l => l.curriculumId !== 'original-prepa')!;
    assert.equal(drafts, 2); assert.equal(verifications, 2); assert.equal(lesson.status, 'failed');
    assert.match(lesson.error!, /after one revision/); assert.match(lesson.error!, /Exercise 2 remains ambiguous/);
    assert.equal(data.runs.find(r => r.kind === 'prepare')?.error, lesson.error);
    assert.equal(data.exercises.filter(e => e.generated).length, 0);
  } finally { await fx.close(); }
});

test('repair cannot bypass source checks or publish an unsupported reference', async () => {
  let drafts = 0, verifications = 0;
  const unsupported = { ...preparedLesson, resources: [{ title: 'Invented reference', url: 'https://example.com/unsupported-source' }] };
  const fx = await fixture({ ...proposeProvider(), generate: async <T>(instruction: string) => {
    if (instruction.startsWith('Independently')) { verifications++; return { valid: true, reason: '' } as T; }
    drafts++; return structuredClone(unsupported) as T;
  } });
  try {
    await chat(fx, 'Prepare a history path.'); await fx.settle(); const proposal = (await fx.store().readLearning()).proposals[0];
    await fx.request(`/api/learning/proposals/${proposal.id}/accept`, 'POST', { revision: proposal.revision }); await fx.settle();
    const data = await fx.store().readLearning(); const lesson = data.lessons.find(l => l.curriculumId !== 'original-prepa')!;
    assert.equal(drafts, 2); assert.equal(verifications, 0); assert.equal(lesson.status, 'failed');
    assert.match(lesson.error!, /Resource 1 is unsupported/); assert.equal(data.exercises.filter(e => e.generated).length, 0);
  } finally { await fx.close(); }
});

test('extensions continue phase numbering and deferred lessons retain their own accepted brief and materials', async () => {
  let materialId = '', description = 'Teach derivations and numbered questions over two sessions.';
  const preparations: any[] = [], verifications: any[] = [];
  const base = fixtureLearningProvider();
  const fx = await fixture({ ...base,
    run: request => toolReply(request, 'propose_learning', { ...historyProposal, kind: 'expand', expansion: 'followup',
      targetCurriculumId: 'original-prepa', description, materialIds: [materialId] }),
    generate: async <T>(instructions: string, payload: unknown, schema: Record<string, unknown>) => {
      if (instructions.startsWith('Prepare')) preparations.push(payload);
      if (instructions.startsWith('Independently')) verifications.push(payload);
      return base.generate<T>(instructions, payload, schema);
    },
  });
  try {
    materialId = (await (await fx.request('/api/learning/materials', 'POST', { title: 'Accepted teaching notes', kind: 'note', text: 'Explain the evidence behind each claim.' })).json()).id;
    await chat(fx, 'Extend this curriculum.'); await fx.settle();
    const first = (await fx.store().readLearning()).proposals[0];
    assert.equal((await fx.request(`/api/learning/proposals/${first.id}/accept`, 'POST', { revision: first.revision })).status, 202);
    await fx.settle();
    let data = await fx.store().readLearning();
    const firstLessons = data.lessons.filter(lesson => lesson.sourceProposalId === first.id);
    assert.deepEqual(firstLessons.map(lesson => lesson.phase), [7, 8]);
    assert.deepEqual(firstLessons.map(lesson => lesson.status), ['ready', 'planned']);
    assert.equal(preparations[0].proposal.description, description);

    description = 'A different extension brief, which must not leak into the previous one.';
    materialId = (await (await fx.request('/api/learning/materials', 'POST', { title: 'Later notes', kind: 'note', text: 'A different teaching context.' })).json()).id;
    await chat(fx, 'Extend it again.'); await fx.settle();
    const second = (await fx.store().readLearning()).proposals.at(-1)!;
    await fx.request(`/api/learning/proposals/${second.id}/accept`, 'POST', { revision: second.revision }); await fx.settle();
    data = await fx.store().readLearning();
    assert.deepEqual(data.lessons.filter(lesson => lesson.sourceProposalId === second.id).map(lesson => lesson.phase), [9, 10]);

    await fx.restart();
    await fx.request(`/api/learning/lessons/${firstLessons[1].id}/prepare`, 'POST', {}); await fx.settle();
    assert.equal(preparations.at(-1).proposal.id, first.id);
    assert.equal(preparations.at(-1).proposal.description, first.description);
    assert.deepEqual(preparations.at(-1).materials.map((m: { title: string }) => m.title), ['Accepted teaching notes']);
    assert.equal(verifications.at(-1).proposal.id, first.id);
    assert.equal((await fx.store().readLearning()).lessons.find(lesson => lesson.id === firstLessons[1].id)?.status, 'ready');
  } finally { await fx.close(); }
});
