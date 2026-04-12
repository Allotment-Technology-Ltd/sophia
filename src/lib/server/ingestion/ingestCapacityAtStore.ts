/**
 * Once a worker enters Surreal Stage 6 (no LLM), it stops counting against
 * durable-job URL concurrency and releases the Neon global ingest gate slot,
 * so another URL can start while the first finishes store I/O.
 *
 * Trade-off: multiple workers may hit Surreal concurrently; tune
 * INGEST_PASSAGE_INSERT_CONCURRENCY / INGEST_CLAIM_INSERT_CONCURRENCY if needed.
 */

/** Minimal fields for job-slot / gate decisions. */
export type IngestRunConcurrencyProbe = {
	status: string;
	currentStageKey?: string | null;
};

/**
 * Non-terminal runs in `store` do not consume an “LLM” concurrency slot.
 * Unknown / unloaded runs are treated as still occupying (conservative).
 */
export function ingestRunStillOccupiesLlmConcurrencySlot(
	run: IngestRunConcurrencyProbe | null | undefined
): boolean {
	if (!run) return true;
	if (run.status === 'done' || run.status === 'error') return false;
	if ((run.currentStageKey ?? '').trim().toLowerCase() === 'store') return false;
	return true;
}
