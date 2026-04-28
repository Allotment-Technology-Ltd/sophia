import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { tickIngestionJob } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const POST: RequestHandler = async ({ locals, params }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const id = params.id?.trim();
		if (!id) return json({ error: 'Missing job id' }, { status: 400 });
		await tickIngestionJob(id);
		return json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to tick job';
		return json({ error: message }, { status: 500 });
	}
};

