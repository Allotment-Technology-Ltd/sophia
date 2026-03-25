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

  const state = ingestRunManager.getState(runId);
  if (!state) {
    return json({ error: 'Run not found' }, { status: 404 });
  }

  const now = Date.now();
  const processAlive = Boolean(
    state.process &&
      typeof state.process.exitCode !== 'number' &&
      !state.process.killed
  );
  const processId =
    typeof state.process?.pid === 'number' && state.process.pid > 0 ? state.process.pid : null;
  const lastOutputAt = state.lastOutputAt ?? null;
  const idleForMs = lastOutputAt != null ? Math.max(0, now - lastOutputAt) : null;
  const processStartedAt = state.processStartedAt ?? null;
  const processExitedAt = state.processExitedAt ?? null;

  return json({
    id: state.id,
    status: state.status,
    awaitingSync: state.status === 'awaiting_sync',
    stages: state.stages,
    logLines: state.logLines,
    error: state.error,
    currentStageKey: state.currentStageKey ?? null,
    currentAction: state.currentAction ?? null,
    lastFailureStageKey: state.lastFailureStageKey ?? null,
    resumable: state.resumable === true,
    processAlive,
    processId,
    processStartedAt,
    processExitedAt,
    lastOutputAt,
    idleForMs,
    createdAt: state.createdAt,
    completedAt: state.completedAt,
    syncStartedAt: state.syncStartedAt,
    syncCompletedAt: state.syncCompletedAt
  });
};
