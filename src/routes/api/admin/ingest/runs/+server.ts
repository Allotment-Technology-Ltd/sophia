import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { ingestRunManager } from '$lib/server/ingestRuns';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  return json({ runs: ingestRunManager.listRuns() });
};
