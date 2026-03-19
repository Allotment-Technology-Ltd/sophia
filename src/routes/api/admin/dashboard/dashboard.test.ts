import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssertAdminAccess, mockLoadAdminDashboardData } = vi.hoisted(() => ({
	mockAssertAdminAccess: vi.fn(() => ({ uid: 'admin-1', email: 'admin@example.com' })),
	mockLoadAdminDashboardData: vi.fn()
}));

vi.mock('$lib/server/adminAccess', () => ({
	assertAdminAccess: mockAssertAdminAccess
}));

vi.mock('$lib/server/adminDashboard', () => ({
	loadAdminDashboardData: mockLoadAdminDashboardData
}));

describe('/api/admin/dashboard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns dashboard data for admins', async () => {
		mockLoadAdminDashboardData.mockResolvedValue({
			stats: { sources: 1, claims: 2, arguments: 3, relations: 4 },
			sources: [],
			domainDistribution: [],
			relationDistribution: [],
			averageValidationScore: 0.91,
			recentIngestions: [],
			apiKeys: []
		});

		const { GET } = await import('./+server');
		const response = await GET({
			locals: { user: { uid: 'admin-1', email: 'admin@example.com', role: 'administrator' } }
		} as any);

		expect(response.status).toBe(200);
		expect(mockAssertAdminAccess).toHaveBeenCalled();
		expect(mockLoadAdminDashboardData).toHaveBeenCalled();
		const body = await response.json();
		expect(body.stats.relations).toBe(4);
	});
});
