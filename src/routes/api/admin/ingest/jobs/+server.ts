import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	createIngestionJob,
	listRecentIngestionJobs,
	tickAllRunningIngestionJobs
} from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled (DATABASE_URL + config).' }, { status: 503 });
		}
		const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') ?? '40', 10) || 40));
		/** Global tick can take minutes with many jobs and blocks this response — list UI uses tick=0 by default. */
		const runTick = ['1', 'true', 'yes'].includes((url.searchParams.get('tick') ?? '').trim().toLowerCase());
		let globalTickJobsProcessed: number | undefined;
		if (runTick) {
			globalTickJobsProcessed = await tickAllRunningIngestionJobs();
		}
		const jobs = await listRecentIngestionJobs(limit);
		return json({
			jobs,
			...(runTick ? { globalTickJobsProcessed } : {})
		});
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
			validate?: unknown;
			merge_into_latest_running_job?: unknown;
			worker_defaults?: unknown;
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
		const validate = payload.validate === true;
		const mergeIntoLatestRunningJob = payload.merge_into_latest_running_job === true;
		const created = await createIngestionJob({
			urls,
			concurrency,
			notes,
			actorUid: actor.uid,
			actorEmail: actor.email ?? null,
			validate,
			mergeIntoLatestRunningJob,
			workerDefaults: payload.worker_defaults
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
