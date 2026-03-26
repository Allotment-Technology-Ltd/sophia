import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  computeSkillScoresFromHistory,
  computeTrajectoryDelta,
  generateProgressRecommendation
} from '$lib/server/learn/pipeline';
import {
  listCompletedLessonIds,
  listProgressEssays,
  saveProgressSnapshot
} from '$lib/server/learn/store';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';
import { getLearnEntitlementSummary } from '$lib/server/learn/entitlements';
import { hasOwnerRole } from '$lib/server/authRoles';

export const GET: RequestHandler = async ({ locals }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  const uid = requireUid(locals);
  if (!uid) return unauthorizedResponse();

  const ownerBypass = hasOwnerRole(locals.user);
  const [completedUnits, essays, learnEntitlements] = await Promise.all([
    listCompletedLessonIds(uid),
    listProgressEssays(uid),
    getLearnEntitlementSummary(uid, { ownerBypass })
  ]);

  const dimensionRows = essays
    .map((row) => row.dimension_scores)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const skills = computeSkillScoresFromHistory(
    dimensionRows.length > 0
      ? dimensionRows
      : [
          { clarity: 50, coherence: 50, critique_depth: 50, originality: 50 }
        ]
  );

  const summaryScores = essays
    .map((row) => row.summary_score)
    .filter((score): score is number => typeof score === 'number');

  const trajectoryDelta = computeTrajectoryDelta(summaryScores);

  const recommendation = await generateProgressRecommendation({
    skills,
    trajectoryDelta,
    completedUnits: completedUnits.length,
    essayCount: essays.length
  });

  await saveProgressSnapshot(uid, {
    skills,
    recommendation,
    trajectory_delta: trajectoryDelta,
    completed_units: completedUnits,
    essay_history: essays.map((row) => row.id)
  });

  return json({
    skills,
    recommendation,
    trajectory_delta: trajectoryDelta,
    completed_units: completedUnits,
    essay_count: essays.length,
    recent_scores: summaryScores.slice(0, 10),
    learn_entitlements: learnEntitlements
  });
};
