import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { adminDb } from '$lib/server/firebase-admin';

const COLLECTION = 'ingestion_run_reports';

/**
 * Aggregated signals from recent ingestion run reports (Phase 0 analytics).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  assertAdminAccess(locals);

  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '80', 10) || 80));

  try {
    const snap = await adminDb
      .collection(COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(limit)
      .get();

    const byStatus: Record<string, number> = {};
    const issueKindTotals: Record<string, number> = {};
    let totalIssues = 0;
    const terminalErrors: string[] = [];

    for (const doc of snap.docs) {
      const d = doc.data();
      const status = typeof d.status === 'string' && d.status.trim() ? d.status.trim() : 'unknown';
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      const n = typeof d.issueCount === 'number' && Number.isFinite(d.issueCount) ? d.issueCount : 0;
      totalIssues += n;

      const summary = d.issueSummary && typeof d.issueSummary === 'object' ? d.issueSummary : null;
      if (summary) {
        for (const [k, v] of Object.entries(summary)) {
          const add = typeof v === 'number' && Number.isFinite(v) ? v : 1;
          issueKindTotals[k] = (issueKindTotals[k] ?? 0) + add;
        }
      }

      if (typeof d.terminalError === 'string' && d.terminalError.trim()) {
        const te = d.terminalError.trim().slice(0, 500);
        if (terminalErrors.length < 24 && !terminalErrors.includes(te)) terminalErrors.push(te);
      }
    }

    return json({
      sampleSize: snap.docs.length,
      limit,
      byStatus,
      totalIssues,
      issueKindTotals,
      terminalErrorSamples: terminalErrors
    });
  } catch (e) {
    console.warn('[ingest/analytics]', e instanceof Error ? e.message : String(e));
    return json(
      {
        sampleSize: 0,
        limit,
        byStatus: {},
        totalIssues: 0,
        issueKindTotals: {},
        terminalErrorSamples: [] as string[],
        error: 'Could not load analytics. Ensure Firestore index for ingestion_run_reports (completedAt desc) exists.'
      },
      { status: 200 }
    );
  }
};
