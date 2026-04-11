import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { cancelReembedJob } from '$lib/server/ingestion/reembedCorpusJob';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const POST: RequestHandler = async ({ locals, params }) => {
	assertAdminAccess(locals);
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ ok: false, error: 'Neon persistence is not enabled (DATABASE_URL).' }, { status: 503 });
	}
	const ok = await cancelReembedJob(params.id);
	if (!ok) {
		return json({ ok: false, error: 'Job could not be cancelled (not found or already terminal).' }, { status: 400 });
	}
	return json({ ok: true });
};
