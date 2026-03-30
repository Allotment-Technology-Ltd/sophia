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
	const recordIds = Array.isArray((body as { record_ids?: unknown }).record_ids)
		? ((body as { record_ids: unknown[] }).record_ids
				.map((v) => (typeof v === 'string' ? v.trim() : ''))
				.filter(Boolean) as string[])
		: [];
	if (recordIds.length === 0) {
		return json({ error: 'record_ids[] is required' }, { status: 400 });
	}
	const result = await bulkSetQueueStatus({ recordIds, status: 'approved' });
	return json(result);
};

