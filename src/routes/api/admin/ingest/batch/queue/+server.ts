import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	estimateCoverageForPack,
	listStoaQueue,
	queueStoaUrls
} from '$lib/server/stoaIngestionBatch';

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	const statusRaw = (url.searchParams.get('status') ?? 'all').trim();
	const status =
		statusRaw === 'all' ||
		statusRaw === 'approved' ||
		statusRaw === 'pending_review' ||
		statusRaw === 'queued' ||
		statusRaw === 'ingesting' ||
		statusRaw === 'ingested' ||
		statusRaw === 'failed' ||
		statusRaw === 'rejected'
			? statusRaw
			: 'all';
	const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('limit') ?? '120', 10) || 120));
	const rows = await listStoaQueue({ status, limit });
	return json({ rows, status, limit });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const record = (body ?? {}) as Record<string, unknown>;
	const urls = Array.isArray(record.urls)
		? record.urls.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
		: [];
	if (urls.length === 0) {
		return json({ error: 'urls[] is required' }, { status: 400 });
	}
	const previewOnly = record.preview_only === true;
	if (previewOnly) {
		const coverage = estimateCoverageForPack(urls);
		return json({ preview: true, ...coverage });
	}

	const result = await queueStoaUrls({
		urls,
		actorUid: actor.uid,
		sourcePackId: typeof record.source_pack_id === 'string' ? record.source_pack_id : null
	});
	return json(result, { status: 201 });
};

