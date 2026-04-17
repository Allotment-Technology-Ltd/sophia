import { desc, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getDrizzleDb } from '$lib/server/db/neon';
import { ingestRuns } from '$lib/server/db/schema';
import { listRecentIngestRunReportSummaries } from '$lib/server/ingestRunIssues';
import { ingestRunManager } from '$lib/server/ingestRuns';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { listBatchRuns } from '$lib/server/stoaIngestionBatch';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  const [runs, recentReports, rawBatchRuns, awaitingPromoteNeon] = await Promise.all([
    Promise.resolve(ingestRunManager.listRuns()),
    listRecentIngestRunReportSummaries(60),
    listBatchRuns(30),
    (async () => {
      if (!isNeonIngestPersistenceEnabled()) return [] as Array<{ id: string; sourceUrl: string; status: string; updatedAt: string }>;
      const db = getDrizzleDb();
      const rows = await db
        .select({
          id: ingestRuns.id,
          sourceUrl: ingestRuns.sourceUrl,
          status: ingestRuns.status,
          updatedAt: ingestRuns.updatedAt
        })
        .from(ingestRuns)
        .where(eq(ingestRuns.status, 'awaiting_promote'))
        .orderBy(desc(ingestRuns.updatedAt))
        .limit(80);
      return rows.map((r) => ({
        id: r.id,
        sourceUrl: r.sourceUrl,
        status: r.status,
        updatedAt: r.updatedAt.toISOString()
      }));
    })()
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
  return json({ runs, recentReports, batchRuns, awaitingPromoteNeon });
};
