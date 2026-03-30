import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listUnresolvedThinkerReferences } from '$lib/server/thinkerReviewQueue';

function parseStatus(raw: string | null): 'queued' | 'resolved' | 'rejected' | 'all' {
	if (raw === 'resolved' || raw === 'rejected' || raw === 'all') return raw;
	return 'queued';
}

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	const status = parseStatus(url.searchParams.get('status'));
	const limitRaw = Number(url.searchParams.get('limit') ?? '50');
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

	const items = await listUnresolvedThinkerReferences({ status, limit });
	return json({ status, limit, count: items.length, items });
};
