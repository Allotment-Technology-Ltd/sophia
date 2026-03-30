import type { PageServerLoad } from './$types';
import { loadStoaObservabilitySummary } from '$lib/server/stoa/observability';
import { assertAdminAccess } from '$lib/server/adminAccess';

export const load: PageServerLoad = async ({ locals }) => {
  assertAdminAccess(locals);
  const summary = await loadStoaObservabilitySummary();
  return { summary };
};

