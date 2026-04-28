import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { pickGutenbergPhilosophyUrlsForBatch } from '$lib/server/gutenbergPhilosophyBatchPick';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
		const excludeIngested = url.searchParams.get('excludeIngested') !== '0';
		const result = await pickGutenbergPhilosophyUrlsForBatch({ limit, excludeIngested });
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to suggest Gutenberg URLs';
		return json({ error: message }, { status: 400 });
	}
};

