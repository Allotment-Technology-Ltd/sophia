import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { pruneSupersededFailedIngestRuns } from '$lib/server/db/pruneSupersededFailedIngestRuns';

export const POST: RequestHandler = async ({ locals, request }) => {
  assertAdminAccess(locals);
  let body: unknown = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const dryRun = Boolean((body as { dryRun?: unknown }).dryRun);
  const limitRaw = Number((body as { limit?: unknown }).limit ?? 500);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10_000, Math.trunc(limitRaw))) : 500;

  try {
    const result = await pruneSupersededFailedIngestRuns({ dryRun, limit });
    return json({ ok: true, result });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Cleanup prune failed.' },
      { status: 500 }
    );
  }
};

