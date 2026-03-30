import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateSubscriptionCheckout,
  mockEnsureBillingState,
  mockUpsertBillingProfile,
  mockGetOrCreateDefaultWorkspace
} = vi.hoisted(() => ({
  mockCreateSubscriptionCheckout: vi.fn(),
  mockEnsureBillingState: vi.fn(),
  mockUpsertBillingProfile: vi.fn(),
  mockGetOrCreateDefaultWorkspace: vi.fn()
}));

vi.mock('$lib/server/billing/paddle', () => ({
  createSubscriptionCheckout: mockCreateSubscriptionCheckout
}));

vi.mock('$lib/server/billing/store', () => ({
  ensureBillingState: mockEnsureBillingState,
  upsertBillingProfile: mockUpsertBillingProfile
}));

vi.mock('$lib/server/billing/workspaces', () => ({
  getOrCreateDefaultWorkspace: mockGetOrCreateDefaultWorkspace
}));

vi.mock('$lib/server/billing/flags', () => ({
  BILLING_FEATURE_ENABLED: true
}));

vi.mock('$lib/server/billing/checkout-settings', () => ({
  getCheckoutPresentation: () => ({ mode: 'overlay' })
}));

vi.mock('$lib/server/billing/founder', () => ({
  founderOfferSummaryFromProfile: () => null
}));

import { POST } from './+server';

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureBillingState.mockResolvedValue({
      profile: { status: 'inactive', paddle_subscription_id: null },
      effectiveTier: 'free'
    });
    mockGetOrCreateDefaultWorkspace.mockResolvedValue({
      id: 'default:user_123'
    });
    mockCreateSubscriptionCheckout.mockResolvedValue({
      checkoutUrl: 'https://checkout.paddle.test',
      priceId: 'pri_test_usd',
      transactionId: 'txn_test_123'
    });
    mockUpsertBillingProfile.mockResolvedValue(undefined);
  });

  it('uses selected USD currency and returns transaction id', async () => {
    const request = new Request('http://localhost/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tier: 'pro',
        currency: 'USD',
        accept_terms: true,
        accept_privacy: true
      })
    });

    const response = await POST({
      request,
      locals: {
        user: { uid: 'user_123', email: 'u@example.com', roles: [] }
      }
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.transaction_id).toBe('txn_test_123');
    expect(payload.currency).toBe('USD');
    expect(payload.workspace_id).toBe('default:user_123');

    expect(mockCreateSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'user_123',
        workspaceId: 'default:user_123',
        currency: 'USD',
        billingPeriod: 'monthly'
      })
    );
  });
});
