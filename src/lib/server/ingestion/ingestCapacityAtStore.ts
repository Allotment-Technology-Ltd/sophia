/**
 * Once a worker enters Surreal Stage 6 (no LLM), it stops counting against
 * durable-job URL concurrency and releases the Neon global ingest gate slot,
 * so another URL can start while the first finishes store I/O.
 *
 * Trade-off: multiple workers may hit Surreal concurrently; tune
 * INGEST_PASSAGE_INSERT_CONCURRENCY / INGEST_CLAIM_INSERT_CONCURRENCY if needed.
 *
 * {@link computeIngestionJobTickSpawnCap} limits how many pending URLs one job tick starts when
 * every active child is already in store (so LLM slots look “empty” but workers are still busy).
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

/**
 * How many pending job items `tickIngestionJob` may spawn in one pass.
 *
 * When every running child is in Surreal **store**, {@link ingestRunStillOccupiesLlmConcurrencySlot}
 * is false for each, so `jobConcurrency - llmSlotOccupants` equals the full job limit — without a cap,
 * one poller tick would start **all** pending URLs at once. While those store workers are still active,
 * only start **one** new LLM-backed child per tick so the queue drains gradually.
 *
 * Cold start (`runningItemCount === 0`) keeps the full LLM budget so the first tick can fill
 * `jobConcurrency` parallel runs as before.
 */
export function computeIngestionJobTickSpawnCap(args: {
	jobConcurrency: number;
	llmSlotOccupants: number;
	runningItemCount: number;
}): number {
	const raw = Math.max(0, args.jobConcurrency - args.llmSlotOccupants);
	if (args.llmSlotOccupants === 0 && args.runningItemCount > 0) {
		return Math.min(raw, 1);
	}
	return raw;
}
