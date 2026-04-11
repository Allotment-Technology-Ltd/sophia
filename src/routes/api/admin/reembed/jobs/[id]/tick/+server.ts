import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { tickReembedJob } from '$lib/server/ingestion/reembedCorpusJob';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

/** Manual advance (one batch / stage); production relies on ingestion-job-poller. */
export const POST: RequestHandler = async ({ locals, params }) => {
	assertAdminAccess(locals);
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ ok: false, error: 'Neon persistence is not enabled (DATABASE_URL).' }, { status: 503 });
	}
	await tickReembedJob(params.id);
	return json({ ok: true });
};
