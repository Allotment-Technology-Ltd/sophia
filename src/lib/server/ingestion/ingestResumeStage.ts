/**
 * Pipeline stage ordering for `scripts/ingest.ts` resume / `--force-stage` merge.
 * Keep in sync with `STAGES_ORDER` in `scripts/ingest.ts`.
 */
export const INGEST_PIPELINE_STAGES_ORDER = [
	'extracting',
	'relating',
	'grouping',
	'embedding',
	'validating',
	'remediating',
	'storing'
] as const;

const ORDER = INGEST_PIPELINE_STAGES_ORDER as readonly string[];

/** Numeric order for Surreal `stage_completed` + disk partial `stored` (not in pipeline order). */
export function completedStageOrderRank(stage: string | null | undefined): number {
	if (!stage) return -1;
	const s = stage.trim();
	if (s === 'stored') return INGEST_PIPELINE_STAGES_ORDER.length;
	return ORDER.indexOf(s);
}

/** Pick the later pipeline checkpoint (merges `--force-stage` floor with `ingestion_log` / partial resume). */
export function laterCompletedStage(a: string | null, b: string | null): string | null {
	const ra = completedStageOrderRank(a);
	const rb = completedStageOrderRank(b);
	if (ra < 0 && rb < 0) return null;
	if (ra < 0) return b;
	if (rb < 0) return a;
	return ra >= rb ? a : b;
}

/** Validation-only tail needs embeddings + prior graph checkpoints — met once last-completed is `embedding` or later. */
export function validationOnlyEmbeddingCheckpointMet(resumeAfter: string | null | undefined): boolean {
	return completedStageOrderRank(resumeAfter) >= INGEST_PIPELINE_STAGES_ORDER.indexOf('embedding');
}

/**
 * Maps Surreal `stage_completed` (last **fully finished** pipeline stage) to an `ingestion_log.status`
 * value allowed by `scripts/setup-ingestion-log.ts` ASSERT. Used when resuming so operators do not
 * see `extracting` while the process is about to jump to store. `remediating` has no dedicated status —
 * use `validating` for the post-embed tail until Stage 6, then `storing`.
 */
export function ingestionLogStatusReflectingCheckpoint(
	lastStageCompleted: string | null | undefined
): 'fetching' | 'extracting' | 'relating' | 'grouping' | 'embedding' | 'validating' | 'storing' {
	const raw = (lastStageCompleted ?? '').trim();
	const s = raw.toLowerCase();
	if (!s || s === 'none') return 'extracting';
	if (s === 'stored') return 'storing';
	const idx = ORDER.indexOf(s);
	if (idx < 0) return 'extracting';
	if (idx >= INGEST_PIPELINE_STAGES_ORDER.length - 1) return 'storing';
	const next = INGEST_PIPELINE_STAGES_ORDER[idx + 1]!;
	if (next === 'remediating') return 'validating';
	if (next === 'extracting') return 'extracting';
	if (next === 'relating') return 'relating';
	if (next === 'grouping') return 'grouping';
	if (next === 'embedding') return 'embedding';
	if (next === 'validating') return 'validating';
	if (next === 'storing') return 'storing';
	return 'extracting';
}
