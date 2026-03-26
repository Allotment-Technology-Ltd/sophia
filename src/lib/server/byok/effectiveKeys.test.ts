import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderApiKeys } from './types';

const mockLoadByokProviderApiKeys = vi.fn<(uid: string) => Promise<ProviderApiKeys>>();
const mockHasAdministratorRole = vi.fn<(user: { role?: string | null; roles?: string[] | null } | null | undefined) => boolean>();
const mockHasOwnerRole = vi.fn<(user: { role?: string | null; roles?: string[] | null } | null | undefined) => boolean>();

vi.mock('./store', () => ({
	loadByokProviderApiKeys: (uid: string) => mockLoadByokProviderApiKeys(uid)
}));

vi.mock('$lib/server/authRoles', () => ({
	hasAdministratorRole: (user: { role?: string | null; roles?: string[] | null } | null | undefined) =>
		mockHasAdministratorRole(user),
	hasOwnerRole: (user: { role?: string | null; roles?: string[] | null } | null | undefined) =>
		mockHasOwnerRole(user)
}));

describe('loadInquiryEffectiveProviderApiKeys', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.OWNER_UIDS;
		mockHasAdministratorRole.mockReturnValue(false);
		mockHasOwnerRole.mockReturnValue(false);
	});

	afterEach(() => {
		delete process.env.OWNER_UIDS;
	});

	it('returns current user keys when configured', async () => {
		mockLoadByokProviderApiKeys.mockResolvedValueOnce({ anthropic: 'sk-ant-user' });
		const { loadInquiryEffectiveProviderApiKeys } = await import('./effectiveKeys');

		const keys = await loadInquiryEffectiveProviderApiKeys(
			{ uid: 'user-1', role: 'user' },
			'test route'
		);

		expect(keys).toEqual({ anthropic: 'sk-ant-user' });
		expect(mockLoadByokProviderApiKeys).toHaveBeenCalledTimes(1);
		expect(mockLoadByokProviderApiKeys).toHaveBeenCalledWith('user-1');
	});

	it('falls back to owner keys for administrator when user has no keys', async () => {
		process.env.OWNER_UIDS = 'owner-1,owner-2';
		mockHasAdministratorRole.mockReturnValue(true);
		mockLoadByokProviderApiKeys
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ openai: 'sk-openai-owner' });
		const { loadInquiryEffectiveProviderApiKeys } = await import('./effectiveKeys');

		const keys = await loadInquiryEffectiveProviderApiKeys(
			{ uid: 'admin-1', role: 'administrator' },
			'analyse route'
		);

		expect(keys).toEqual({ openai: 'sk-openai-owner' });
		expect(mockLoadByokProviderApiKeys).toHaveBeenNthCalledWith(1, 'admin-1');
		expect(mockLoadByokProviderApiKeys).toHaveBeenNthCalledWith(2, 'owner-1');
	});

	it('does not fallback for non-admin users', async () => {
		process.env.OWNER_UIDS = 'owner-1';
		mockLoadByokProviderApiKeys.mockResolvedValueOnce({});
		const { loadInquiryEffectiveProviderApiKeys } = await import('./effectiveKeys');

		const keys = await loadInquiryEffectiveProviderApiKeys(
			{ uid: 'user-2', role: 'user' },
			'verify route'
		);

		expect(keys).toEqual({});
		expect(mockLoadByokProviderApiKeys).toHaveBeenCalledTimes(1);
		expect(mockLoadByokProviderApiKeys).toHaveBeenCalledWith('user-2');
	});

	it('returns empty keys when uid is missing', async () => {
		const { loadInquiryEffectiveProviderApiKeys } = await import('./effectiveKeys');

		const keys = await loadInquiryEffectiveProviderApiKeys(
			{ role: 'owner' },
			'allowed-models route'
		);

		expect(keys).toEqual({});
		expect(mockLoadByokProviderApiKeys).not.toHaveBeenCalled();
	});
});
