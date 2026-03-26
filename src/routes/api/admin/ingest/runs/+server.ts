import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listRecentIngestRunReportSummaries } from '$lib/server/ingestRunIssues';
import { ingestRunManager } from '$lib/server/ingestRuns';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  const [runs, recentReports] = await Promise.all([
    Promise.resolve(ingestRunManager.listRuns()),
    listRecentIngestRunReportSummaries(60)
  ]);
  return json({ runs, recentReports });
};
