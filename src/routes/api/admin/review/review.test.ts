import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssertAdminAccess, mockLoadReviewDashboard } = vi.hoisted(() => ({
	mockAssertAdminAccess: vi.fn(() => ({ uid: 'admin-1', email: 'admin@example.com' })),
	mockLoadReviewDashboard: vi.fn()
}));

vi.mock('$lib/server/adminAccess', () => ({
	assertAdminAccess: mockAssertAdminAccess
}));

vi.mock('$lib/server/review/workflow', () => ({
	DUPLICATE_CLASSIFICATIONS: ['exact_duplicate', 'paraphrase_duplicate'],
	REVIEWABLE_RELATION_TABLES: ['supports', 'contradicts', 'depends_on', 'responds_to', 'defines', 'qualifies'],
	loadReviewDashboard: mockLoadReviewDashboard
}));

describe('/api/admin/review', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns dashboard review data for admins', async () => {
		mockLoadReviewDashboard.mockResolvedValue({
			trustedGraphActive: true,
			claimCounts: { accepted: 1, candidate: 2, needs_review: 3, rejected: 4, merged: 5 },
			relationCounts: { accepted: 6, candidate: 7, needs_review: 8, rejected: 9, merged: 10 },
			claimQueue: [],
			relationQueue: [],
			duplicateSuggestions: [],
			recentAudit: []
		});

		const { GET } = await import('./+server');
		const response = await GET({
			locals: { user: { uid: 'admin-1', email: 'admin@example.com', role: 'administrator' } },
			url: new URL('http://localhost/api/admin/review?limit=12')
		} as any);

		expect(response.status).toBe(200);
		expect(mockAssertAdminAccess).toHaveBeenCalled();
		expect(mockLoadReviewDashboard).toHaveBeenCalledWith(12);
		const body = await response.json();
		expect(body.reviewStates).toContain('accepted');
	});
});
