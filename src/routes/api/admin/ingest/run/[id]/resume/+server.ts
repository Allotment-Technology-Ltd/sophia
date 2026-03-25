import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager } from '$lib/server/ingestRuns';

export const POST: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);

  const runId = params.id;
  if (!runId) {
    return json({ error: 'Missing run ID' }, { status: 400 });
  }

  const result = ingestRunManager.resumeFromFailure(runId);
  if (!result.ok) {
    return json({ error: result.error }, { status: 400 });
  }

  return json({ ok: true, run_id: runId, resumed: true });
};
