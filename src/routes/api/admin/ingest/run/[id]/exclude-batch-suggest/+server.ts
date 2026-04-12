import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager } from '$lib/server/ingestRuns';

/** PATCH body: `{ "excludeFromBatchSuggest": true | false }` — Neon operator flag for SEP batch URL helper. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);
  const runId = params.id?.trim();
  if (!runId) {
    return json({ error: 'Missing run ID' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const raw = (body as { excludeFromBatchSuggest?: unknown })?.excludeFromBatchSuggest;
  if (typeof raw !== 'boolean') {
    return json({ error: 'Body must include boolean excludeFromBatchSuggest' }, { status: 400 });
  }

  const result = await ingestRunManager.setExcludeFromBatchSuggest(runId, raw);
  if (!result.ok) {
    const notFound = /not found/i.test(result.error);
    return json({ error: result.error }, { status: notFound ? 404 : 400 });
  }
  return json({ ok: true, excludeFromBatchSuggest: raw });
};
