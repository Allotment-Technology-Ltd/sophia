import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager, type IngestRunState } from '$lib/server/ingestRuns';

function buildPipelineActivityPayload(state: IngestRunState): Record<string, unknown> {
  const proc = state.process;
  const processAlive = Boolean(
    proc && typeof proc.exitCode !== 'number' && !proc.killed
  );
  const processId = typeof proc?.pid === 'number' && proc.pid > 0 ? proc.pid : null;

  return {
    kind: 'sophia.ingest.pipeline_activity',
    exportedAt: new Date().toISOString(),
    runId: state.id,
    status: state.status,
    awaitingSync: state.status === 'awaiting_sync',
    awaitingPromote: state.status === 'awaiting_promote',
    stages: state.stages,
    logLines: state.logLines,
    logLineCount: state.logLines.length,
    issues: state.issues,
    issueCount: state.issues.length,
    error: state.error ?? null,
    currentStageKey: state.currentStageKey ?? null,
    currentAction: state.currentAction ?? null,
    lastFailureStageKey: state.lastFailureStageKey ?? null,
    resumable: state.resumable === true,
    validate: state.payload.validate === true,
    createdAt: state.createdAt,
    completedAt: state.completedAt ?? null,
    processAlive,
    processId,
    processStartedAt: state.processStartedAt ?? null,
    processExitedAt: state.processExitedAt ?? null,
    lastOutputAt: state.lastOutputAt ?? null,
    workerHeartbeatAt: state.workerHeartbeatAt ?? null,
    syncStartedAt: state.syncStartedAt ?? null,
    syncCompletedAt: state.syncCompletedAt ?? null,
    excludeFromBatchSuggest: state.excludeFromBatchSuggest === true
  };
}

/** Downloadable JSON: full in-memory pipeline activity for a run on this server instance. */
export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);

  const runId = params.id?.trim();
  if (!runId) {
    return new Response(JSON.stringify({ error: 'Missing run ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const state = await ingestRunManager.getStateAsync(runId);
  if (!state) {
    return new Response(
      JSON.stringify({
        error: 'Run not in memory on this server',
        hint: 'Open this run on the worker that executed it, or use Export on the run console after a report snapshot loads.'
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }

  const payload = buildPipelineActivityPayload(state);
  const body = JSON.stringify(payload, null, 2);
  const filename = `sophia-pipeline-activity-${runId}.json`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
};
