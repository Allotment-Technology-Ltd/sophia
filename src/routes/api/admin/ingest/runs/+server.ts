import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listRecentIngestRunReportSummaries } from '$lib/server/ingestRunIssues';
import { ingestRunManager } from '$lib/server/ingestRuns';
import { listBatchRuns } from '$lib/server/stoaIngestionBatch';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  const [runs, recentReports, rawBatchRuns] = await Promise.all([
    Promise.resolve(ingestRunManager.listRuns()),
    listRecentIngestRunReportSummaries(60),
    listBatchRuns(30)
  ]);
  const batchRuns = rawBatchRuns.map((run) => ({
    id: run.id,
    status: run.status,
    createdAtMs: run.createdAtMs,
    updatedAtMs: run.updatedAtMs,
    sourcePackId: run.sourcePackId,
    requestedByEmail: run.requestedByEmail,
    summary: run.summary
  }));
  return json({ runs, recentReports, batchRuns });
};
