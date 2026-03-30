import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';

const COLLECTION = 'ingestion_run_reports';

type Bucket = { runCount: number; issueKindTotals: Record<string, number>; issueEvents: number };

function emptyBucket(): Bucket {
  return { runCount: 0, issueKindTotals: {}, issueEvents: 0 };
}

function addIssueKinds(target: Record<string, number>, summary: Record<string, unknown> | null): number {
  if (!summary) return 0;
  let events = 0;
  for (const [k, v] of Object.entries(summary)) {
    const add = typeof v === 'number' && Number.isFinite(v) ? v : 1;
    target[k] = (target[k] ?? 0) + add;
    events += add;
  }
  return events;
}

/**
 * Aggregated signals from recent ingestion run reports (preset tuning + ops).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  assertAdminAccess(locals);

  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '80', 10) || 80));

  try {
    const snap = await sophiaDocumentsDb
      .collection(COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(limit)
      .get();

    const byStatus: Record<string, number> = {};
    const issueKindTotals: Record<string, number> = {};
    let totalIssues = 0;
    const terminalErrors: string[] = [];

    const bySourceType: Record<string, Bucket> = {};
    const byPipelinePreset: Record<string, Bucket> = {};
    const issueKindByStageHint: Record<string, Record<string, number>> = {};

    for (const doc of snap.docs) {
      const d = doc.data() ?? {};
      const status = typeof d.status === 'string' && d.status.trim() ? d.status.trim() : 'unknown';
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      const n = typeof d.issueCount === 'number' && Number.isFinite(d.issueCount) ? d.issueCount : 0;
      totalIssues += n;

      const summary =
        d.issueSummary && typeof d.issueSummary === 'object' && !Array.isArray(d.issueSummary)
          ? (d.issueSummary as Record<string, unknown>)
          : null;
      if (summary) {
        for (const [k, v] of Object.entries(summary)) {
          const add = typeof v === 'number' && Number.isFinite(v) ? v : 1;
          issueKindTotals[k] = (issueKindTotals[k] ?? 0) + add;
        }
      }

      const sourceType =
        typeof d.sourceType === 'string' && d.sourceType.trim() ? d.sourceType.trim() : 'unknown';
      const stBucket = (bySourceType[sourceType] ??= emptyBucket());
      stBucket.runCount += 1;
      stBucket.issueEvents += addIssueKinds(stBucket.issueKindTotals, summary);

      const presetRaw = d.pipelinePreset;
      const presetKey =
        presetRaw === 'production' ||
        presetRaw === 'budget' ||
        presetRaw === 'balanced' ||
        presetRaw === 'complexity'
          ? presetRaw
          : 'unknown';
      const prBucket = (byPipelinePreset[presetKey] ??= emptyBucket());
      prBucket.runCount += 1;
      prBucket.issueEvents += addIssueKinds(prBucket.issueKindTotals, summary);

      const issues = Array.isArray(d.issues) ? d.issues : [];
      for (const row of issues) {
        if (!row || typeof row !== 'object') continue;
        const kind =
          typeof (row as { kind?: unknown }).kind === 'string' ? (row as { kind: string }).kind : 'unknown';
        const hintRaw = (row as { stageHint?: unknown }).stageHint;
        const stageHint =
          typeof hintRaw === 'string' && hintRaw.trim() ? hintRaw.trim() : 'none';
        if (!issueKindByStageHint[kind]) issueKindByStageHint[kind] = {};
        issueKindByStageHint[kind][stageHint] = (issueKindByStageHint[kind][stageHint] ?? 0) + 1;
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
      bySourceType,
      byPipelinePreset,
      issueKindByStageHint,
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
        bySourceType: {} as Record<string, Bucket>,
        byPipelinePreset: {} as Record<string, Bucket>,
        issueKindByStageHint: {} as Record<string, Record<string, number>>,
        terminalErrorSamples: [] as string[],
        error:
          'Could not load analytics. Ensure Firestore index for ingestion_run_reports (completedAt desc) exists.'
      },
      { status: 200 }
    );
  }
};
