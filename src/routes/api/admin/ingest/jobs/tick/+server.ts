import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { tickAllRunningIngestionJobs } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const POST: RequestHandler = async ({ locals }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled (DATABASE_URL + config).' }, { status: 503 });
		}
		const globalTickJobsProcessed = await tickAllRunningIngestionJobs();
		return json({ ok: true, globalTickJobsProcessed });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to tick jobs';
		return json({ error: message }, { status: 500 });
	}
};

