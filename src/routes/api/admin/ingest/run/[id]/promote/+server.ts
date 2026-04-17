import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager } from '$lib/server/ingestRuns';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  const runId = params.id;
  if (!runId) {
    return json({ error: 'Missing run ID' }, { status: 400 });
  }

  let stopBeforeStore = true;
  try {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const body = (await request.json()) as { stop_before_store?: unknown };
      if (body.stop_before_store === false) stopBeforeStore = false;
    }
  } catch {
    /* empty body */
  }

  const result = await ingestRunManager.promoteStagedExtractionRun(runId, { stop_before_store: stopBeforeStore });
  if (!result.ok) {
    return json({ error: result.error }, { status: 400 });
  }

  return json({ ok: true, run_id: runId, promoted: true });
};
