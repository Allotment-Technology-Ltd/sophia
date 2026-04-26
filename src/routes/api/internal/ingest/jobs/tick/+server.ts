import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tickAllRunningIngestionJobs } from '$lib/server/ingestionJobs';
import { tickAllRunningReembedJobs } from '$lib/server/ingestion/reembedCorpusJob';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { verifyIngestionJobTickSecret } from '$lib/server/ingestion/internalIngestionJobTickAuth';

/**
 * Internal/scheduled advance for durable Neon ingestion and re-embed jobs (same as
 * `scripts/ingestion-job-poller.ts` / Cloud Run Job `sophia-ingestion-job-poller`). Protect with
 * `INGESTION_JOB_TICK_SECRET` + `Authorization: Bearer <secret>`. Railway cron, GitHub Actions,
 * or a second long-running process can `POST` here in place of GCP.
 */
export const POST: RequestHandler = async ({ request }) => {
	const authz = request.headers.get('authorization');
	if (!verifyIngestionJobTickSecret(authz)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ error: 'Neon ingest persistence is not enabled (DATABASE_URL + config).' }, { status: 503 });
	}
	const ingestionJobIdsProcessed = await tickAllRunningIngestionJobs();
	const reembedJobIdsProcessed = await tickAllRunningReembedJobs();
	return json({ ok: true, ingestionJobIdsProcessed, reembedJobIdsProcessed });
};
