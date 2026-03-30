import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { createStoaBatchRun, listBatchRuns } from '$lib/server/stoaIngestionBatch';

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25));
	const runs = await listBatchRuns(limit);
	return json({ runs });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const payload = body as {
		concurrency?: unknown;
		limit?: unknown;
		status_filter?: unknown;
		source_pack_id?: unknown;
		notes?: unknown;
	};
	const concurrency =
		typeof payload.concurrency === 'number' && Number.isFinite(payload.concurrency)
			? Math.trunc(payload.concurrency)
			: 2;
	const limit =
		typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? Math.trunc(payload.limit) : 30;
	const statusFilter =
		payload.status_filter === 'approved' ||
		payload.status_filter === 'pending_review' ||
		payload.status_filter === 'queued'
			? payload.status_filter
			: 'approved';
	const run = await createStoaBatchRun({
		actorUid: actor.uid,
		actorEmail: actor.email ?? null,
		concurrency,
		limit,
		statusFilter,
		sourcePackId: typeof payload.source_pack_id === 'string' ? payload.source_pack_id : null,
		notes: typeof payload.notes === 'string' ? payload.notes : null
	});
	return json({ run }, { status: 201 });
};

