import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { createReembedJob, listReembedJobs } from '$lib/server/ingestion/reembedCorpusJob';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ ok: false, error: 'Neon persistence is not enabled (DATABASE_URL).' }, { status: 503 });
	}
	const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
	const jobs = await listReembedJobs(limit);
	return json({ ok: true, jobs });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ ok: false, error: 'Neon persistence is not enabled (DATABASE_URL).' }, { status: 503 });
	}
	let body: { batch_size?: number } = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		body = {};
	}
	try {
		const created = await createReembedJob({
			actorEmail: actor.email ?? null,
			batchSize: typeof body.batch_size === 'number' ? body.batch_size : undefined
		});
		if (!created) {
			return json({ ok: false, error: 'Could not create job.' }, { status: 503 });
		}
		return json({ ok: true, id: created.id });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 400 });
	}
};
