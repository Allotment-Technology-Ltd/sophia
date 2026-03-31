import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { resumeBatchItem } from '$lib/server/stoaIngestionBatch';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	assertAdminAccess(locals);
	const runId = typeof params.id === 'string' ? params.id.trim() : '';
	if (!runId) return json({ error: 'Missing run id' }, { status: 400 });

	let body: unknown = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const payload = body as { queue_record_id?: unknown };
	const queueRecordId = typeof payload.queue_record_id === 'string' ? payload.queue_record_id.trim() : '';
	if (!queueRecordId) return json({ error: 'queue_record_id is required' }, { status: 400 });

	try {
		const run = await resumeBatchItem(runId, queueRecordId);
		if (!run) return json({ error: 'Batch run not found' }, { status: 404 });
		return json({ run });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to resume batch item';
		return json({ error: message }, { status: 400 });
	}
};
