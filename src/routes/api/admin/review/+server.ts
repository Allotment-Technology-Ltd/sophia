import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { DUPLICATE_CLASSIFICATIONS, loadReviewDashboard } from '$lib/server/review/workflow';
import { REVIEW_STATE_OPTIONS } from '$lib/server/review/adminReviewApi';

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	const limitRaw = Number(url.searchParams.get('limit') ?? '24');
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 24;

	return json({
		dashboard: await loadReviewDashboard(limit),
		reviewStates: REVIEW_STATE_OPTIONS,
		duplicateClassifications: DUPLICATE_CLASSIFICATIONS
	});
};
