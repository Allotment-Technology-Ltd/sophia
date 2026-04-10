import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { retryIngestionJob, type IngestionJobRetryMode } from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const jobId = params.id?.trim();
		if (!jobId) return json({ error: 'Missing job id' }, { status: 400 });

		let body: { mode?: string; itemId?: string } = {};
		try {
			body = (await request.json()) as { mode?: string; itemId?: string };
		} catch {
			body = {};
		}
		const rawMode = (body.mode ?? 'restart').toLowerCase();
		if (rawMode !== 'restart' && rawMode !== 'resume') {
			return json({ error: 'Body.mode must be "restart" or "resume".' }, { status: 400 });
		}
		const mode = rawMode as IngestionJobRetryMode;

		const result = await retryIngestionJob(jobId, mode, {
			itemId: typeof body.itemId === 'string' ? body.itemId : undefined
		});

		if (!result.ok) {
			return json({ error: result.error }, { status: 400 });
		}

		return json({
			ok: true,
			touched: result.touched,
			resumeResults: result.resumeResults
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Retry failed';
		return json({ error: message }, { status: 500 });
	}
};
