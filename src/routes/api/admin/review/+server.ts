import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { DUPLICATE_CLASSIFICATIONS, loadReviewDashboard } from '$lib/server/review/workflow';
import { REVIEW_STATE_OPTIONS } from '$lib/server/review/adminReviewApi';
import type { ReviewDashboardData } from '$lib/server/review/workflow';

export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	const limitRaw = Number(url.searchParams.get('limit') ?? '24');
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 24;
	let warning: string | null = null;

	const fallbackDashboard: ReviewDashboardData = {
		trustedGraphActive: false,
		claimCounts: { candidate: 0, accepted: 0, rejected: 0, merged: 0, needs_review: 0 },
		relationCounts: { candidate: 0, accepted: 0, rejected: 0, merged: 0, needs_review: 0 },
		claimQueue: [],
		relationQueue: [],
		duplicateSuggestions: [],
		recentAudit: []
	};

	let dashboard = fallbackDashboard;
	try {
		dashboard = await loadReviewDashboard(limit);
	} catch (error) {
		console.error('[admin/review] dashboard load failed, returning fallback dashboard', error);
		warning = 'Review dashboard data is temporarily unavailable. Showing an empty queue.';
	}

	return json({
		dashboard,
		reviewStates: REVIEW_STATE_OPTIONS,
		duplicateClassifications: DUPLICATE_CLASSIFICATIONS,
		warning
	});
};
