import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getProgress } from '$lib/server/stoa/game/progress-store.js';

/**
 * GET /api/stoa/progress
 * Returns the current StoaProgressState for the authenticated user.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const uid = locals.user?.uid;
	if (!uid) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		const progress = await getProgress(uid);
		return json(progress);
	} catch (error) {
		if (process.env.NODE_ENV !== 'test') {
			console.error('[STOA] Failed to load progress:', error instanceof Error ? error.message : String(error));
		}
		return json({ error: 'Failed to load progress' }, { status: 500 });
	}
};
