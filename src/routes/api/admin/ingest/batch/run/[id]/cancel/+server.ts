import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { cancelBatchRun } from '$lib/server/stoaIngestionBatch';

export const POST: RequestHandler = async ({ locals, params }) => {
	assertAdminAccess(locals);
	const runId = typeof params.id === 'string' ? params.id.trim() : '';
	if (!runId) return json({ error: 'Missing run id' }, { status: 400 });
	const run = await cancelBatchRun(runId);
	if (!run) return json({ error: 'Batch run not found' }, { status: 404 });
	return json({ run });
};

