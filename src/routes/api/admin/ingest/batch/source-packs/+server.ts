import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getSourcePacks, saveSourcePack, estimateCoverageForPack } from '$lib/server/stoaIngestionBatch';

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	const packs = await getSourcePacks();
	return json({ packs });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const payload = body as { id?: unknown; name?: unknown; description?: unknown; urls?: unknown };
	const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : '';
	const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : '';
	const urls = Array.isArray(payload.urls)
		? payload.urls.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
		: [];
	if (!id || !name || urls.length === 0) {
		return json({ error: 'id, name, and urls[] are required' }, { status: 400 });
	}
	await saveSourcePack({
		id,
		name,
		description: typeof payload.description === 'string' ? payload.description.trim() : '',
		urls
	});
	const coverage = estimateCoverageForPack(urls);
	return json({ ok: true, coverage });
};

