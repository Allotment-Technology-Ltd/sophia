import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listBatchRuns, listStoaQueue } from '$lib/server/stoaIngestionBatch';

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	const [runs, queueRows] = await Promise.all([listBatchRuns(120), listStoaQueue({ status: 'all', limit: 500 })]);
	const queueByStatus: Record<string, number> = {};
	for (const row of queueRows) {
		const k = typeof row.status === 'string' ? row.status : 'unknown';
		queueByStatus[k] = (queueByStatus[k] ?? 0) + 1;
	}
	const runByStatus: Record<string, number> = {};
	let itemsTotal = 0;
	let itemsDone = 0;
	let itemsError = 0;
	let itemsCancelled = 0;
	for (const run of runs) {
		runByStatus[run.status] = (runByStatus[run.status] ?? 0) + 1;
		itemsTotal += run.summary.total;
		itemsDone += run.summary.done;
		itemsError += run.summary.error;
		itemsCancelled += run.summary.cancelled;
	}
	return json({
		sampleRuns: runs.length,
		queueByStatus,
		runByStatus,
		itemMetrics: {
			total: itemsTotal,
			done: itemsDone,
			error: itemsError,
			cancelled: itemsCancelled,
			successRate: itemsTotal > 0 ? Number((itemsDone / itemsTotal).toFixed(4)) : 0
		},
		acceptanceChecks: [
			'All queued STOA rows carry pass_hints with license + reuse mode.',
			'Batch run item status transitions are observable and replayable.',
			'Error rows are re-runnable via batch resume.',
			'Source licensing policy blocks non-open hosts for full-text ingestion.'
		]
	});
};

