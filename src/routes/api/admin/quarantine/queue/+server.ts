import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { loadQuarantineClaimQueue } from '$lib/server/ingestion/quarantineQueue';

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	try {
		const maxScore = Number(url.searchParams.get('max_score') ?? '80');
		const limit = Number(url.searchParams.get('limit') ?? '40');
		const sourceUrlContains = url.searchParams.get('source') ?? undefined;

		const rows = await loadQuarantineClaimQueue({
			maxScore: Number.isFinite(maxScore) ? maxScore : 80,
			limit: Number.isFinite(limit) ? limit : 40,
			sourceUrlContains: sourceUrlContains ?? undefined
		});

		return json({ claims: rows });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load quarantine queue';
		return json({ error: message, claims: [] }, { status: 500 });
	}
};
