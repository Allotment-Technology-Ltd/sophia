/**
 * Re-merge `ingestion_jobs.worker_defaults` into a child run payload so durable-job **restarts / resumes**
 * keep pipeline shape (e.g. `forceStage: validating`) when Neon `ingest_runs.payload` lost or never had those keys.
 */

import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/neon';
import { ingestionJobs } from '../db/schema';
import { normalizeModelChain, type IngestRunPayload } from '../ingestRuns';
import { sanitizeIngestionJobWorkerDefaults } from '../ingestionJobWorkerDefaults';

/** Reads optional pipeline flags stored alongside sanitized batch_overrides on `ingestion_jobs.worker_defaults`. */
export function applyJobPipelineFlagsFromWorkerDefaults(
  payload: IngestRunPayload,
  workerDefaults: unknown
): IngestRunPayload {
  if (!workerDefaults || typeof workerDefaults !== 'object' || Array.isArray(workerDefaults)) {
    return payload;
  }
  const o = workerDefaults as Record<string, unknown>;
  const stopAfter = o.stop_after_extraction === true;
  const stopBefore = o.stop_before_store === true;
  if (!stopAfter && !stopBefore) return payload;
  let next: IngestRunPayload = { ...payload };
  if (stopAfter) {
    next.stop_after_extraction = true;
    next.stop_before_store = false;
  } else if (stopBefore) {
    next.stop_before_store = true;
  }
  return next;
}

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

/** Merge `model_chain` + OpenAI-compatible extraction hints stored on `ingestion_jobs.worker_defaults`. */
export function mergeJobModelChainAndExtractionIntoPayload(
	payload: IngestRunPayload,
	jobWorkerDefaults: unknown
): IngestRunPayload {
	if (!jobWorkerDefaults || typeof jobWorkerDefaults !== 'object' || Array.isArray(jobWorkerDefaults)) {
		return payload;
	}
	const wd = jobWorkerDefaults as Record<string, unknown>;
	let next = payload;

	const rawMc = wd.model_chain;
	if (rawMc && typeof rawMc === 'object' && !Array.isArray(rawMc)) {
		const merged = normalizeModelChain({
			...payload.model_chain,
			...(rawMc as Partial<IngestRunPayload['model_chain']>)
		});
		if (JSON.stringify(merged) !== JSON.stringify(payload.model_chain)) {
			next = { ...next, model_chain: merged };
		}
	}

	const url =
		typeof wd.extractionOpenAiCompatibleBaseUrl === 'string' ? wd.extractionOpenAiCompatibleBaseUrl.trim() : '';
	const model =
		typeof wd.extractionOpenAiCompatibleModel === 'string' ? wd.extractionOpenAiCompatibleModel.trim() : '';
	if (!url && !model) return next;

	const bo = { ...(next.batch_overrides ?? {}) };
	if (url) bo.extractionOpenAiCompatibleBaseUrl = url;
	if (model) bo.extractionOpenAiCompatibleModel = model;
	if (JSON.stringify(bo) === JSON.stringify(next.batch_overrides ?? null)) return next;
	return { ...next, batch_overrides: bo };
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
  next = applyJobPipelineFlagsFromWorkerDefaults(next, row.workerDefaults);
  next = mergeJobModelChainAndExtractionIntoPayload(next, row.workerDefaults);
  if (row.validateLlm === true && next.validate !== true) {
    next = { ...next, validate: true };
  }

  const unchanged =
    next.validate === payload.validate &&
    JSON.stringify(next.batch_overrides ?? null) === JSON.stringify(payload.batch_overrides ?? null) &&
    JSON.stringify(next.model_chain) === JSON.stringify(payload.model_chain) &&
    next.stop_after_extraction === payload.stop_after_extraction &&
    next.stop_before_store === payload.stop_before_store;
  return unchanged ? payload : next;
}
