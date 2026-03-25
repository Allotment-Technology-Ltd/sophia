import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { runIngestionCoach } from '$lib/server/ingestionAdvisor';

/**
 * Offline ingestion coach from recent Firestore run reports.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  assertAdminAccess(locals);

  let limit = 30;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === 'object' && typeof (body as { limit?: unknown }).limit === 'number') {
      limit = (body as { limit: number }).limit;
    }
  } catch {
    /* use default */
  }

  const result = await runIngestionCoach(limit);
  return json(result);
};
