import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { cancelEntireIngestionJob } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

/** Stop the whole durable job: cancel pending items, abandon running child runs in Neon, set job `cancelled`. */
export const POST: RequestHandler = async ({ locals, params }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const jobId = params.id?.trim();
		if (!jobId) return json({ error: 'Missing job id' }, { status: 400 });

		const result = await cancelEntireIngestionJob(jobId);
		if (!result.ok) {
			const notFound = /not found/i.test(result.error);
			const badState = /already finished/i.test(result.error);
			return json(
				{ error: result.error },
				{ status: notFound ? 404 : badState ? 409 : 400 }
			);
		}

		return json({
			ok: true,
			previousStatus: result.previousStatus,
			pendingCancelled: result.pendingCancelled,
			runningAbandoned: result.runningAbandoned
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Cancel failed';
		return json({ error: message }, { status: 500 });
	}
};
