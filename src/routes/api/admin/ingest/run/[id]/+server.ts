import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager } from '$lib/server/ingestRuns';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);

  const runId = params.id;
  if (!runId) {
    return json({ error: 'Missing run ID' }, { status: 400 });
  }

  const state = await ingestRunManager.getStateAsync(runId);
  if (!state) {
    return json({ error: 'Run not found' }, { status: 404 });
  }

  const processAlive = Boolean(
    state.process &&
      typeof state.process.exitCode !== 'number' &&
      !state.process.killed
  );

  return json({
    id: state.id,
    status: state.status,
    awaitingSync: state.status === 'awaiting_sync',
    awaitingPromote: state.status === 'awaiting_promote',
    stages: state.stages,
    logLines: state.logLines,
    issues: state.issues,
    issueCount: state.issues.length,
    error: state.error,
    currentStageKey: state.currentStageKey ?? null,
    currentAction: state.currentAction ?? null,
    lastFailureStageKey: state.lastFailureStageKey ?? null,
    resumable: state.resumable === true,
    validate: state.payload.validate === true,
    createdAt: state.createdAt,
    completedAt: state.completedAt,
    excludeFromBatchSuggest: state.excludeFromBatchSuggest === true,
    processAlive
  });
};
