import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tickAllRunningIngestionJobs } from '$lib/server/ingestionJobs';
import { tickAllRunningReembedJobs } from '$lib/server/ingestion/reembedCorpusJob';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import {
	isIngestionJobTickHttpEnabled,
	verifyIngestionJobTickSecret
} from '$lib/server/ingestion/internalIngestionJobTickAuth';

/**
 * Internal/scheduled advance for durable Neon ingestion and re-embed jobs (same as
 * `scripts/ingestion-job-poller.ts` / Cloud Run Job `sophia-ingestion-job-poller`). Protect with
 * `INGESTION_JOB_TICK_SECRET` + `Authorization: Bearer <secret>`. Railway cron, GitHub Actions,
 * or a second long-running process can `POST` here in place of GCP.
 */
export const POST: RequestHandler = async ({ request }) => {
	/** 503: tick not enabled on this deployment (no secret) — 401 is reserved for wrong/missing token when enabled */
	if (!isIngestionJobTickHttpEnabled()) {
		return json(
			{
				error: 'ingestion_job_tick_not_configured',
				hint: 'Set INGESTION_JOB_TICK_SECRET on the Railway service and redeploy so the route accepts the scheduler Bearer token.'
			},
			{ status: 503 }
		);
	}
	const authz = request.headers.get('authorization');
	if (!verifyIngestionJobTickSecret(authz)) {
		return json(
			{
				error: 'ingestion_job_tick_unauthorized',
				hint: 'Confirm GitHub secret INGESTION_JOB_TICK_SECRET matches Railway (no extra line breaks; redeploy after changing Railway).'
			},
			{ status: 401 }
		);
	}
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ error: 'Neon ingest persistence is not enabled (DATABASE_URL + config).' }, { status: 503 });
	}
	const ingestionJobIdsProcessed = await tickAllRunningIngestionJobs();
	const reembedJobIdsProcessed = await tickAllRunningReembedJobs();
	return json({ ok: true, ingestionJobIdsProcessed, reembedJobIdsProcessed });
};
