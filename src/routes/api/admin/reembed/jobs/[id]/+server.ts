import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getReembedJob, listReembedJobEvents } from '$lib/server/ingestion/reembedCorpusJob';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	assertAdminAccess(locals);
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ ok: false, error: 'Neon persistence is not enabled (DATABASE_URL).' }, { status: 503 });
	}
	const job = await getReembedJob(params.id);
	if (!job) {
		return json({ ok: false, error: 'Job not found.' }, { status: 404 });
	}
	const withEvents = url.searchParams.get('events') === '1';
	const eventLimit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('event_limit') ?? '100', 10) || 100));
	const events = withEvents ? await listReembedJobEvents(params.id, eventLimit) : undefined;
	return json({ ok: true, job, events });
};
