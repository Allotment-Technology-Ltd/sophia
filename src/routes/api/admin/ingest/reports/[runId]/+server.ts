import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { adminDb } from '$lib/server/firebase-admin';

const COLLECTION = 'ingestion_run_reports';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
  if (!runId) return json({ error: 'Missing runId' }, { status: 400 });

  try {
    const snap = await adminDb.collection(COLLECTION).doc(runId).get();
    if (!snap.exists) {
      return json({ error: 'Report not found' }, { status: 404 });
    }
    const d = snap.data();
    if (!d) return json({ error: 'Report not found' }, { status: 404 });

    return json({
      runId: typeof d.runId === 'string' ? d.runId : snap.id,
      status: typeof d.status === 'string' ? d.status : null,
      sourceUrl: typeof d.sourceUrl === 'string' ? d.sourceUrl : '',
      sourceType: typeof d.sourceType === 'string' ? d.sourceType : '',
      modelChain: d.modelChain && typeof d.modelChain === 'object' ? d.modelChain : null,
      pipelinePreset: d.pipelinePreset ?? null,
      embeddingModel: d.embeddingModel ?? null,
      validate: d.validate === true,
      issueCount: typeof d.issueCount === 'number' ? d.issueCount : 0,
      issueSummary: d.issueSummary && typeof d.issueSummary === 'object' ? d.issueSummary : {},
      terminalError: typeof d.terminalError === 'string' ? d.terminalError : null,
      lastFailureStageKey: typeof d.lastFailureStageKey === 'string' ? d.lastFailureStageKey : null,
      timingTelemetry: d.timingTelemetry && typeof d.timingTelemetry === 'object' ? d.timingTelemetry : null,
      routingStats: d.routingStats && typeof d.routingStats === 'object' ? d.routingStats : null,
      completedAtMs: typeof d.completedAt?.toMillis === 'function' ? d.completedAt.toMillis() : null,
      createdAtMs: typeof d.createdAt?.toMillis === 'function' ? d.createdAt.toMillis() : null
    });
  } catch (e) {
    console.warn('[ingest/reports/runId]', e instanceof Error ? e.message : String(e));
    return json({ error: 'Failed to load report' }, { status: 500 });
  }
};
