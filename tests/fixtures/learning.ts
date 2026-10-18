import type { LearningAgentProvider, LearningAgentRequest } from '../../server/learning-provider.js';

export const preparedLesson = {
  primer: 'A historical source reflects its author, audience and purpose. Compare its claims with independent evidence.',
  objectives: ['Identify an author’s claim and evaluate supporting evidence.'], resources: [],
  exercises: [1, 2].map(index => ({ title: `Evaluate source ${index}`, difficulty: 'practice' as const, minutes: 10,
    prompt: 'A mayor claims that a new park improved everyone’s health. Identify one piece of independent evidence needed to assess the claim.',
    starter: '', skills: ['Evidence evaluation'], hints: ['Who made the claim?', 'Consider who was measured.', 'Compare outcomes before and after, accounting for other changes.'],
    solution: 'Compare representative health outcomes before and after the park, using a comparable population without the intervention.',
    answer: 'Independent comparative evidence on representative health outcomes.', rubric: [{ criterion: 'Names relevant independent evidence', points: 5 }, { criterion: 'Explains a limitation or comparison', points: 5 }] })),
};
export const historyProposal = {
  title: 'Reading history critically', description: 'Learn to evaluate historical sources.', topic: 'history', level: 'Beginner', goal: 'Compare historical claims with evidence.', kind: 'curriculum' as const,
  lessons: [{ title: 'Claims and evidence', summary: 'Evaluate sources.', objectives: ['Distinguish claims and evidence.'] }, { title: 'Compare perspectives', summary: 'Read contrasting accounts.', objectives: ['Identify differing perspectives.'] }],
};
export function fixtureLearningProvider(run?: LearningAgentProvider['run'], generate?: LearningAgentProvider['generate']): LearningAgentProvider {
  return { model: 'fixture',
    run: run ?? (async request => { await request.onText?.('Let’s explore that.'); const output = [{ role: 'assistant', content: 'Let’s explore that.' }]; await request.onCheckpoint?.([...request.input, ...output], 40); return { output, text: 'Let’s explore that.', inputTokens: 40 }; }),
    compact: async input => [{ type: 'compaction', encrypted_content: 'fixture-only' }, ...input.filter(i => (i as {role?: string})?.role === 'user').slice(-1)],
    generate: generate ?? (async <T>(instructions: string) => (instructions.startsWith('Independently') ? { valid: true, reason: 'Fixture content verified' } : instructions.startsWith('Review') ? { message: 'Consider comparing one more independent source.', memory: 'Observed interest in historical evidence; confidence is not proof of mastery.' } : structuredClone(preparedLesson)) as T),
  };
}
export async function toolReply(request: LearningAgentRequest, name: string, args: unknown, callId = 'fixture-call') {
  const call = { type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId };
  await request.onCheckpoint?.([...request.input, call], 50);
  const result = await request.executeTool(name, args, callId);
  const output = [call, { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) }, { role: 'assistant', content: 'Here is an outline to review.' }];
  await request.onCheckpoint?.([...request.input, ...output], 100);
  return { output, text: 'Here is an outline to review.', inputTokens: 100 };
}
