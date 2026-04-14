import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	modifyIngestionJobItem,
	type IngestionJobItemModifyAction
} from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const jobId = params.id?.trim();
		const itemId = params.itemId?.trim();
		if (!jobId) return json({ error: 'Missing job id' }, { status: 400 });
		if (!itemId) return json({ error: 'Missing item id' }, { status: 400 });

		let body: { action?: string } = {};
		try {
			body = (await request.json()) as { action?: string };
		} catch {
			body = {};
		}
		const raw = (body.action ?? '').trim().toLowerCase();
		if (raw !== 'requeue_to_pending' && raw !== 'cancel') {
			return json(
				{
					error:
						raw === ''
							? 'Missing JSON body or action. Send Content-Type: application/json with {"action":"requeue_to_pending"} or {"action":"cancel"}.'
							: 'Body.action must be "requeue_to_pending" or "cancel".'
				},
				{ status: 400 }
			);
		}
		const action = raw as IngestionJobItemModifyAction;

		const result = await modifyIngestionJobItem(jobId, itemId, action);
		if (!result.ok) {
			return json({ error: result.error }, { status: 400 });
		}
		return json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Request failed';
		return json({ error: message }, { status: 500 });
	}
};
