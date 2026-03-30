import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { neonGetReportEnvelope } from '$lib/server/db/ingestRunRepository';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

const COLLECTION = 'ingestion_run_reports';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
  if (!runId) return json({ error: 'Missing runId' }, { status: 400 });

  try {
    if (isNeonIngestPersistenceEnabled()) {
      const env = await neonGetReportEnvelope(runId);
      if (!env) return json({ error: 'Report not found' }, { status: 404 });
      const completedAtMs =
        typeof env.completedAtMs === 'number'
          ? env.completedAtMs
          : typeof env.completedAt === 'object' &&
              env.completedAt !== null &&
              'toMillis' in env.completedAt &&
              typeof (env.completedAt as { toMillis?: () => number }).toMillis === 'function'
            ? (env.completedAt as { toMillis: () => number }).toMillis()
            : null;
      const createdAtMs =
        typeof env.createdAtMs === 'number'
          ? env.createdAtMs
          : typeof env.createdAt === 'object' &&
              env.createdAt !== null &&
              'toMillis' in env.createdAt &&
              typeof (env.createdAt as { toMillis?: () => number }).toMillis === 'function'
            ? (env.createdAt as { toMillis: () => number }).toMillis()
            : null;
      return json({
        runId: typeof env.runId === 'string' ? env.runId : runId,
        status: typeof env.status === 'string' ? env.status : null,
        sourceUrl: typeof env.sourceUrl === 'string' ? env.sourceUrl : '',
        sourceType: typeof env.sourceType === 'string' ? env.sourceType : '',
        modelChain: env.modelChain && typeof env.modelChain === 'object' ? env.modelChain : null,
        pipelinePreset: env.pipelinePreset ?? null,
        embeddingModel: env.embeddingModel ?? null,
        validate: env.validate === true,
        issueCount: typeof env.issueCount === 'number' ? env.issueCount : 0,
        issueSummary: env.issueSummary && typeof env.issueSummary === 'object' ? env.issueSummary : {},
        terminalError: typeof env.terminalError === 'string' ? env.terminalError : null,
        lastFailureStageKey:
          typeof env.lastFailureStageKey === 'string' ? env.lastFailureStageKey : null,
        timingTelemetry:
          env.timingTelemetry && typeof env.timingTelemetry === 'object' ? env.timingTelemetry : null,
        routingStats: env.routingStats && typeof env.routingStats === 'object' ? env.routingStats : null,
        completedAtMs,
        createdAtMs
      });
    }

    const snap = await sophiaDocumentsDb.collection(COLLECTION).doc(runId).get();
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
