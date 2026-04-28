import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	listIngestionJobDlqItems,
	removeDlqJobItems,
	replayDlqJobItems,
	tickIngestionJob
} from '$lib/server/ingestionJobs';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') ?? '80', 10) || 80));
		const items = await listIngestionJobDlqItems(limit);
		return json({ items });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list DLQ';
		return json({ error: message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Invalid JSON body' }, { status: 400 });
		}
		const itemIds = (body as { itemIds?: unknown }).itemIds;
		if (!Array.isArray(itemIds) || itemIds.length === 0) {
			return json({ error: 'Body must include itemIds: string[]' }, { status: 400 });
		}
		const ids = itemIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
		const result = await replayDlqJobItems(ids);
		if (!result.ok) {
			return json({ error: result.error }, { status: 400 });
		}
		for (const jobId of result.jobIds) {
			await tickIngestionJob(jobId);
		}
		return json({ ok: true, replayed: result.replayed });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to replay DLQ';
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Invalid JSON body' }, { status: 400 });
		}
		const itemIds = (body as { itemIds?: unknown }).itemIds;
		if (!Array.isArray(itemIds) || itemIds.length === 0) {
			return json({ error: 'Body must include itemIds: string[]' }, { status: 400 });
		}
		const ids = itemIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
		const result = await removeDlqJobItems(ids);
		if (!result.ok) {
			return json({ error: result.error }, { status: 400 });
		}
		return json({ ok: true, removed: result.removed });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to remove DLQ items';
		return json({ error: message }, { status: 500 });
	}
};
