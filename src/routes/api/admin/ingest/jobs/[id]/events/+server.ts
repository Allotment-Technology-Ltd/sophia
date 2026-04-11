import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listIngestionJobEvents, reconcileIngestionJobView } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const id = params.id?.trim();
		if (!id) return json({ error: 'Missing job id' }, { status: 400 });
		await reconcileIngestionJobView(id);
		const sinceSeq = Math.max(0, Number.parseInt(url.searchParams.get('since_seq') ?? '0', 10) || 0);
		const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200));
		const events = await listIngestionJobEvents(id, { sinceSeq, limit });
		return json({ events });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load events';
		return json({ error: message }, { status: 500 });
	}
};
