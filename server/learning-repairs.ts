import type { LearningData } from '../shared/learning.js';

/** Recover legacy creation links only when the acceptance run and complete outline agree. */
export function repairLessonOrigins(data: LearningData): boolean {
  let changed = false;
  // Storage order is creation order; curriculum display order can change after insertions.
  for (const curriculum of data.curricula) {
    const lessons = data.lessons.filter(lesson => lesson.curriculumId === curriculum.id);
    for (let start = 0; start < lessons.length; start++) {
      const first = lessons[start];
      if (first.sourceProposalId) continue;
      const proposals = data.proposals.filter(proposal => proposal.status === 'accepted'
        && proposal.curriculumId === curriculum.id && proposal.expansion !== 'enrich'
        && data.runs.some(run => run.kind === 'prepare' && run.lessonId === first.id
          && run.proposalId === proposal.id && run.requestId === `accept:${proposal.id}:${proposal.revision}`));
      if (proposals.length !== 1) continue;
      const proposal = proposals[0];
      const created = lessons.slice(start, start + proposal.lessons.length);
      if (created.length !== proposal.lessons.length || created.some((lesson, index) =>
        lesson.sourceProposalId || lesson.title !== proposal.lessons[index].title
        || lesson.summary !== proposal.lessons[index].summary
        || (index > 0 && !lesson.prerequisites.includes(created[index - 1].id)))) continue;

      const legacyNumbering = created.every((lesson, index) => lesson.phase === start + index + 1);
      const lastPhase = Math.max(0, ...lessons.slice(0, start).map(lesson => lesson.phase));
      for (const [index, lesson] of created.entries()) {
        lesson.sourceProposalId = proposal.id;
        if (legacyNumbering) lesson.phase = lastPhase + index + 1;
      }
      changed = true;
    }
  }
  return changed;
}
