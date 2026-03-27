import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import type { IngestRunPayload } from '$lib/server/ingestRuns';
import { ingestRunManager } from '$lib/server/ingestRuns';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  const runId = params.id;
  if (!runId) {
    return json({ error: 'Missing run ID' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  const model_chain = body.model_chain as
    | Partial<{ extract: string; relate: string; group: string; validate: string }>
    | undefined;
  const batch_overrides = body.batch_overrides as
    | Partial<NonNullable<IngestRunPayload['batch_overrides']>>
    | undefined;

  const result = await ingestRunManager.resumeFromFailure(runId, {
    ...(model_chain && typeof model_chain === 'object' ? { model_chain } : {}),
    ...(batch_overrides && typeof batch_overrides === 'object' ? { batch_overrides } : {})
  });
  if (!result.ok) {
    return json({ error: result.error }, { status: 400 });
  }

  return json({ ok: true, run_id: runId, resumed: true });
};
