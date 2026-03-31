import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { resetFailedStoaQueueRows } from '$lib/server/stoaIngestionBatch';

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);
	let body: unknown = {};
	try {
		body = await request.json();
	} catch {
		// Allow empty body and default limit.
	}
	const payload = body as { limit?: unknown };
	const limit =
		typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? Math.trunc(payload.limit) : 2000;
	const result = await resetFailedStoaQueueRows(limit);
	return json(result);
};
