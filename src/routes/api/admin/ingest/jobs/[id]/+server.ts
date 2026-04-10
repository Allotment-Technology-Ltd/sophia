import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getIngestionJobDetail, getIngestionJobItemMaxAttempts, tickIngestionJob } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const id = params.id?.trim();
		if (!id) return json({ error: 'Missing job id' }, { status: 400 });
		await tickIngestionJob(id);
		const detail = await getIngestionJobDetail(id);
		if (!detail) return json({ error: 'Job not found' }, { status: 404 });
		return json({
			...detail,
			itemMaxAttempts: getIngestionJobItemMaxAttempts()
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load job';
		return json({ error: message }, { status: 500 });
	}
};
