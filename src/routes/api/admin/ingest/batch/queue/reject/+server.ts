import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { bulkSetQueueStatus } from '$lib/server/stoaIngestionBatch';

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const payload = body as { record_ids?: unknown; reason?: unknown };
	const recordIds = Array.isArray(payload.record_ids)
		? payload.record_ids.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
		: [];
	if (recordIds.length === 0) return json({ error: 'record_ids[] is required' }, { status: 400 });
	const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : 'manual_reject';
	const result = await bulkSetQueueStatus({
		recordIds,
		status: 'rejected',
		reason
	});
	return json(result);
};

