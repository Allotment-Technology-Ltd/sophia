import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderApiKeys } from './types';

const mockLoadByokProviderApiKeys = vi.fn<(uid: string) => Promise<ProviderApiKeys>>();
const mockHasOwnerRole = vi.fn<(user: { role?: string | null; roles?: string[] | null } | null | undefined) => boolean>();

vi.mock('./store', () => ({
	loadByokProviderApiKeys: (uid: string) => mockLoadByokProviderApiKeys(uid)
}));

vi.mock('$lib/server/authRoles', () => ({
	hasOwnerRole: (user: { role?: string | null; roles?: string[] | null } | null | undefined) =>
		mockHasOwnerRole(user)
}));

describe('loadInquiryEffectiveProviderApiKeys', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.OWNER_UIDS;
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

	it('falls back to owner keys for owner when user has no keys', async () => {
		process.env.OWNER_UIDS = 'owner-1,owner-2';
		mockHasOwnerRole.mockReturnValue(true);
		mockLoadByokProviderApiKeys
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ openai: 'sk-openai-owner' });
		const { loadInquiryEffectiveProviderApiKeys } = await import('./effectiveKeys');

		const keys = await loadInquiryEffectiveProviderApiKeys(
			{ uid: 'owner-actor-1', role: 'owner' },
			'analyse route'
		);

		expect(keys).toEqual({ openai: 'sk-openai-owner' });
		expect(mockLoadByokProviderApiKeys).toHaveBeenNthCalledWith(1, 'owner-actor-1');
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

describe('mergeOwnerEnvFallbackIfEmpty', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.OWNER_UIDS;
	});

	afterEach(() => {
		delete process.env.OWNER_UIDS;
	});

	it('returns keys unchanged when any provider key is present', async () => {
		const { mergeOwnerEnvFallbackIfEmpty } = await import('./effectiveKeys');
		const keys = await mergeOwnerEnvFallbackIfEmpty({ anthropic: 'sk-ant-x' }, 'test');
		expect(keys).toEqual({ anthropic: 'sk-ant-x' });
		expect(mockLoadByokProviderApiKeys).not.toHaveBeenCalled();
	});

	it('uses first OWNER_UIDS bucket when keyset is empty', async () => {
		process.env.OWNER_UIDS = 'owner-a,owner-b';
		mockLoadByokProviderApiKeys.mockResolvedValueOnce({ vertex: 'vk' });
		const { mergeOwnerEnvFallbackIfEmpty } = await import('./effectiveKeys');
		const keys = await mergeOwnerEnvFallbackIfEmpty({}, 'v1 ctx');
		expect(keys).toEqual({ vertex: 'vk' });
		expect(mockLoadByokProviderApiKeys).toHaveBeenCalledTimes(1);
		expect(mockLoadByokProviderApiKeys).toHaveBeenCalledWith('owner-a');
	});

	it('returns empty when OWNER_UIDS unset and keyset empty', async () => {
		const { mergeOwnerEnvFallbackIfEmpty } = await import('./effectiveKeys');
		const keys = await mergeOwnerEnvFallbackIfEmpty({}, 'no owners');
		expect(keys).toEqual({});
		expect(mockLoadByokProviderApiKeys).not.toHaveBeenCalled();
	});

	it('tries next owner when earlier bucket has no keys', async () => {
		process.env.OWNER_UIDS = 'empty-owner,full-owner';
		mockLoadByokProviderApiKeys
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ openai: 'sk-o' });
		const { mergeOwnerEnvFallbackIfEmpty } = await import('./effectiveKeys');
		const keys = await mergeOwnerEnvFallbackIfEmpty({}, 'chain');
		expect(keys).toEqual({ openai: 'sk-o' });
		expect(mockLoadByokProviderApiKeys).toHaveBeenNthCalledWith(1, 'empty-owner');
		expect(mockLoadByokProviderApiKeys).toHaveBeenNthCalledWith(2, 'full-owner');
	});
});
