import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';

const COLLECTION = 'ingestion_run_reports';

/**
 * Recent durable ingestion run reports (Firestore). Used for post-run review and process improvement.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  assertAdminAccess(locals);

  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(80, Math.max(1, Number.parseInt(limitRaw ?? '30', 10) || 30));

  try {
    const snap = await sophiaDocumentsDb
      .collection(COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(limit)
      .get();

    const reports = snap.docs.map((doc) => {
      const d = doc.data() ?? {};
      return {
        id: doc.id,
        runId: d.runId ?? doc.id,
        status: d.status ?? null,
        sourceUrl: d.sourceUrl ?? null,
        sourceType: d.sourceType ?? null,
        actorEmail: d.actorEmail ?? null,
        issueCount: typeof d.issueCount === 'number' ? d.issueCount : 0,
        issueSummary: d.issueSummary && typeof d.issueSummary === 'object' ? d.issueSummary : {},
        completedAt: d.completedAt?.toMillis?.() ?? null,
        createdAt: d.createdAt?.toMillis?.() ?? null,
        terminalError: typeof d.terminalError === 'string' ? d.terminalError : null
      };
    });

    return json({ reports });
  } catch (e) {
    console.warn('[ingest/reports]', e instanceof Error ? e.message : String(e));
    return json(
      {
        reports: [],
        error: 'Could not load reports. If this is the first use, create a composite index for ingestion_run_reports (completedAt desc) or run an ingestion once.'
      },
      { status: 200 }
    );
  }
};
