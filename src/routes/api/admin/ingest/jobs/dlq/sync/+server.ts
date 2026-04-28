import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { syncDlqForAllExhaustedItems } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const POST: RequestHandler = async ({ locals }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const synced = await syncDlqForAllExhaustedItems();
		return json({ ok: true, synced });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to sync DLQ';
		return json({ error: message }, { status: 500 });
	}
};

