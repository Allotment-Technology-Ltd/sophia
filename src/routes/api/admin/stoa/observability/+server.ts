import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { loadStoaObservabilitySummary } from '$lib/server/stoa/observability';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  const summary = await loadStoaObservabilitySummary();
  return json(summary);
};

