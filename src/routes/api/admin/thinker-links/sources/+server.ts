import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listThinkerLinkSourcePreviews } from '$lib/server/thinkerReviewQueue';

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const sourceIdsRaw = (body as { source_ids?: unknown })?.source_ids;
	if (!Array.isArray(sourceIdsRaw)) {
		return json({ error: 'source_ids must be an array' }, { status: 400 });
	}

	const sourceIds = sourceIdsRaw.filter((v): v is string => typeof v === 'string').slice(0, 500);
	const items = await listThinkerLinkSourcePreviews(sourceIds);
	return json({ count: items.length, items });
};
