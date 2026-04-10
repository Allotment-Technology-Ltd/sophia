import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	getIngestExecutionInfo,
	ingestOptInStopBeforeStore,
	ingestRunManager,
	type IngestRunPayload
} from '$lib/server/ingestRuns';

export const POST: RequestHandler = async ({ locals, request }) => {
  const actor = assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Basic validation
  const payload = body as Partial<IngestRunPayload>;
  if (!payload.source_url) {
    return json({ error: 'Missing source_url' }, { status: 400 });
  }
  if (!payload.source_type) {
    return json({ error: 'Missing source_type' }, { status: 400 });
  }
  if (!payload.model_chain) {
    return json({ error: 'Missing model_chain' }, { status: 400 });
  }

  const normalized: IngestRunPayload = {
    ...(payload as IngestRunPayload),
    stop_before_store: ingestOptInStopBeforeStore(payload as Partial<IngestRunPayload>)
  };

  try {
    const runId = await ingestRunManager.createRun(normalized, actor.email || 'unknown');
    const state = await ingestRunManager.getStateAsync(runId);
    const execution = getIngestExecutionInfo();
    return json(
      { run_id: runId, status: state?.status ?? 'running', execution },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const status = /Too many concurrent ingest/i.test(msg) ? 429 : 500;
    return json({ error: msg }, { status });
  }
};
