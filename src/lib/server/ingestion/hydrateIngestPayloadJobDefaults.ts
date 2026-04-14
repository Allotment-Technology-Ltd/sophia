/**
 * Re-merge `ingestion_jobs.worker_defaults` into a child run payload so durable-job **restarts / resumes**
 * keep pipeline shape (e.g. `forceStage: validating`) when Neon `ingest_runs.payload` lost or never had those keys.
 */

import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/neon';
import { ingestionJobs } from '../db/schema';
import type { IngestRunPayload } from '../ingestRuns';
import { sanitizeIngestionJobWorkerDefaults } from '../ingestionJobWorkerDefaults';

/** Job defaults first, then existing run overrides win (per-field). */
export function mergeJobWorkerDefaultsIntoPayload(
	payload: IngestRunPayload,
	jobWorkerDefaults: unknown
): IngestRunPayload {
	const jobBo = sanitizeIngestionJobWorkerDefaults(jobWorkerDefaults) ?? {};
	const cur = payload.batch_overrides ?? {};
	const mergedBo = { ...jobBo, ...cur };
	if (Object.keys(mergedBo).length === 0) return payload;
	const next = { ...payload, batch_overrides: mergedBo };
	if (
		JSON.stringify(payload.batch_overrides ?? null) === JSON.stringify(next.batch_overrides)
	) {
		return payload;
	}
	return next;
}

/**
 * When `payload.ingestion_job_id` is set, load the job row and merge **worker_defaults** + **validate_llm**
 * into the payload (Neon snapshot may be missing `batch_overrides.forceStage` after older writes or edge paths).
 */
export async function hydrateIngestPayloadWithJobRowDefaults(
	payload: IngestRunPayload
): Promise<IngestRunPayload> {
	const jobId = payload.ingestion_job_id?.trim();
	if (!jobId) return payload;

	const db = getDrizzleDb();
	const row = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, jobId),
		columns: { workerDefaults: true, validateLlm: true }
	});
	if (!row) return payload;

	let next = mergeJobWorkerDefaultsIntoPayload(payload, row.workerDefaults);
	if (row.validateLlm === true && next.validate !== true) {
		next = { ...next, validate: true };
	}

	const unchanged =
		next.validate === payload.validate &&
		JSON.stringify(next.batch_overrides ?? null) === JSON.stringify(payload.batch_overrides ?? null);
	return unchanged ? payload : next;
}
