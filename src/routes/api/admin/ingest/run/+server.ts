import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager, type IngestRunPayload } from '$lib/server/ingestRuns';

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

  try {
    const runId = ingestRunManager.createRun(payload as IngestRunPayload, actor.email || 'unknown');
    return json(
      { run_id: runId, status: 'running' },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: msg }, { status: 500 });
  }
};
