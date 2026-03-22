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

  return json({
    id: state.id,
    status: state.status,
    awaitingSync: state.status === 'awaiting_sync',
    stages: state.stages,
    logLines: state.logLines,
    error: state.error,
    createdAt: state.createdAt,
    completedAt: state.completedAt,
    syncStartedAt: state.syncStartedAt,
    syncCompletedAt: state.syncCompletedAt
  });
};
