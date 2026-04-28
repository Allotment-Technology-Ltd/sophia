import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { createIngestionJob, listRecentIngestionJobs } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled (DATABASE_URL + config).' }, { status: 503 });
		}
		const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') ?? '40', 10) || 40));
		const jobs = await listRecentIngestionJobs(limit);
		return json({ jobs });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list jobs';
		return json({ error: message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const actor = assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled (DATABASE_URL + config).' }, { status: 503 });
		}
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Invalid JSON body' }, { status: 400 });
		}
		const payload = body as {
			urls?: unknown;
			concurrency?: unknown;
			notes?: unknown;
			run_reason?: unknown;
			validate?: unknown;
			merge_into_latest_running_job?: unknown;
			worker_defaults?: unknown;
			/** When true, each child run uses `--stop-after-extraction` (bulk Fireworks extraction wave). */
			stop_after_extraction?: unknown;
		};
		const rawUrls = payload.urls;
		if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
			return json({ error: 'Body must include non-empty urls: string[]' }, { status: 400 });
		}
		const urls = rawUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
		if (urls.length === 0) {
			return json({ error: 'No valid URL strings in urls[]' }, { status: 400 });
		}
		const rawConcurrency =
			typeof payload.concurrency === 'number' && Number.isFinite(payload.concurrency)
				? Math.trunc(payload.concurrency)
				: 2;
		const concurrency = Math.max(1, Math.min(MAX_DURABLE_INGEST_JOB_CONCURRENCY, rawConcurrency));
		const notes = typeof payload.notes === 'string' ? payload.notes : null;
		const runReason = typeof payload.run_reason === 'string' ? payload.run_reason : null;
		const validate = payload.validate === true;
		const mergeIntoLatestRunningJob = payload.merge_into_latest_running_job === true;
		let workerDefaults: unknown = payload.worker_defaults;
		if (payload.stop_after_extraction === true) {
			const base =
				workerDefaults && typeof workerDefaults === 'object' && !Array.isArray(workerDefaults)
					? { ...(workerDefaults as Record<string, unknown>) }
					: {};
			base.stop_after_extraction = true;
			workerDefaults = base;
		}
		const created = await createIngestionJob({
			urls,
			concurrency,
			notes,
			runReason,
			actorUid: actor.uid,
			actorEmail: actor.email ?? null,
			validate,
			mergeIntoLatestRunningJob,
			workerDefaults
		});
		if (!created) {
			return json({ error: 'Failed to create job' }, { status: 500 });
		}
		return json({ jobId: created.id, merged: created.merged === true }, { status: 202 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to create job';
		return json({ error: message }, { status: 500 });
	}
};
