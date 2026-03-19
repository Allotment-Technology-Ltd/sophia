import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssertAdminAccess, mockCreateAdminApiKey } = vi.hoisted(() => ({
	mockAssertAdminAccess: vi.fn(() => ({ uid: 'admin-1', email: 'admin@example.com' })),
	mockCreateAdminApiKey: vi.fn()
}));

vi.mock('$lib/server/adminAccess', () => ({
	assertAdminAccess: mockAssertAdminAccess
}));

vi.mock('$lib/server/adminDashboard', () => ({
	createAdminApiKey: mockCreateAdminApiKey
}));

describe('/api/admin/api-keys', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates an API key from JSON input', async () => {
		mockCreateAdminApiKey.mockResolvedValue({
			success: true,
			generatedKey: 'sk-sophia-example',
			keyId: 'key_123',
			owner_uid: 'owner-1',
			name: 'Admin key',
			daily_quota: 100,
			created_at: '2026-03-19T12:00:00.000Z'
		});

		const { POST } = await import('./+server');
		const response = await POST({
			locals: { user: { uid: 'admin-1', email: 'admin@example.com', role: 'administrator' } },
			request: new Request('http://localhost/api/admin/api-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'Admin key',
					owner_uid: 'owner-1',
					daily_quota: 100
				})
			})
		} as any);

		expect(response.status).toBe(201);
		expect(mockAssertAdminAccess).toHaveBeenCalled();
		expect(mockCreateAdminApiKey).toHaveBeenCalledWith(
			{ uid: 'admin-1', email: 'admin@example.com' },
			{ name: 'Admin key', owner_uid: 'owner-1', daily_quota: 100 }
		);
		const body = await response.json();
		expect(body.keyId).toBe('key_123');
	});

	it('rejects malformed JSON bodies', async () => {
		const { POST } = await import('./+server');
		const response = await POST({
			locals: { user: { uid: 'admin-1', email: 'admin@example.com', role: 'administrator' } },
			request: new Request('http://localhost/api/admin/api-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{not valid json'
			})
		} as any);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe('Invalid JSON body');
	});
});
