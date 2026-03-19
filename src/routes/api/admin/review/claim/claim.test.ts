import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssertAdminAccess, mockApplyClaimReviewDecision } = vi.hoisted(() => ({
	mockAssertAdminAccess: vi.fn(() => ({ uid: 'admin-1', email: 'admin@example.com' })),
	mockApplyClaimReviewDecision: vi.fn()
}));

vi.mock('$lib/server/adminAccess', () => ({
	assertAdminAccess: mockAssertAdminAccess
}));

vi.mock('$lib/server/review/workflow', () => ({
	DUPLICATE_CLASSIFICATIONS: ['exact_duplicate', 'paraphrase_duplicate'],
	REVIEWABLE_RELATION_TABLES: ['supports', 'contradicts', 'depends_on', 'responds_to', 'defines', 'qualifies'],
	applyClaimReviewDecision: mockApplyClaimReviewDecision
}));

describe('/api/admin/review/claim', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('applies a claim review decision', async () => {
		mockApplyClaimReviewDecision.mockResolvedValue({
			id: 'claim:1',
			review_state: 'accepted'
		});

		const { POST } = await import('./+server');
		const response = await POST({
			locals: { user: { uid: 'admin-1', email: 'admin@example.com', role: 'administrator' } },
			request: new Request('http://localhost/api/admin/review/claim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					claim_id: 'claim:1',
					next_state: 'accepted',
					notes: 'looks correct'
				})
			})
		} as any);

		expect(response.status).toBe(200);
		expect(mockApplyClaimReviewDecision).toHaveBeenCalledWith({
			claimId: 'claim:1',
			nextState: 'accepted',
			actor: { uid: 'admin-1', email: 'admin@example.com' },
			notes: 'looks correct'
		});
		const body = await response.json();
		expect(body.success).toContain('claim:1');
	});
});
