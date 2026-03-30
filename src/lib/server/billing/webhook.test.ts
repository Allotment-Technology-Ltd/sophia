import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUpsertBillingProfile,
  mockResolveWorkspaceForWebhook,
  mockApplyWorkspaceSubscriptionLifecycleUpdate
} = vi.hoisted(() => ({
  mockUpsertBillingProfile: vi.fn(),
  mockResolveWorkspaceForWebhook: vi.fn(),
  mockApplyWorkspaceSubscriptionLifecycleUpdate: vi.fn()
}));

const customerMap = new Map<string, { uid: string }>();
const eventMap = new Map<string, { event_type: string }>();

function makeDocRef(
  store: Map<string, any>,
  id: string
): {
  get: () => Promise<{ exists: boolean; data: () => any }>;
  set: (data: any) => Promise<void>;
} {
  return {
    get: async () => ({
      exists: store.has(id),
      data: () => store.get(id) ?? {}
    }),
    set: async (data: any) => {
      const existing = store.get(id) ?? {};
      store.set(id, { ...existing, ...data });
    }
  };
}

vi.mock('$lib/server/sophiaDocumentsDb', () => ({
  sophiaDocumentsDb: {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (name === 'billingCustomers') return makeDocRef(customerMap, id);
        if (name === 'billingWebhookEvents') return makeDocRef(eventMap, id);
        return makeDocRef(new Map(), id);
      }
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) =>
      fn({
        get: async (ref: any) => ref.get(),
        set: async (ref: any, data: any) => ref.set(data)
      })
  }
}));

vi.mock('./store', () => ({
  upsertBillingProfile: mockUpsertBillingProfile
}));

vi.mock('./workspaces', () => ({
  resolveWorkspaceForWebhook: mockResolveWorkspaceForWebhook,
  applyWorkspaceSubscriptionLifecycleUpdate: mockApplyWorkspaceSubscriptionLifecycleUpdate
}));

import { handlePaddleWebhookEvent } from './webhook';

describe('handlePaddleWebhookEvent lifecycle handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerMap.clear();
    eventMap.clear();
    mockResolveWorkspaceForWebhook.mockResolvedValue({
      source: 'paddle_subscription_id',
      workspace: { id: 'ws_1', uid: 'user_1', paddle_subscription_id: 'sub_1' }
    });
    mockApplyWorkspaceSubscriptionLifecycleUpdate.mockResolvedValue({
      id: 'ws_1',
      uid: 'user_1',
      plan: 'pro'
    });
    mockUpsertBillingProfile.mockResolvedValue(undefined);
  });

  it('marks workspace pro on activation', async () => {
    const result = await handlePaddleWebhookEvent({
      event_id: 'evt_1',
      event_type: 'subscription.activated',
      data: {
        id: 'sub_1',
        customer_id: 'cus_1',
        status: 'active',
        current_billing_period_end: '2026-05-01T00:00:00.000Z',
        currency_code: 'USD',
        custom_data: {
          uid: 'user_1',
          workspaceId: 'ws_1'
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(mockResolveWorkspaceForWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        workspaceId: 'ws_1',
        uid: 'user_1'
      })
    );
    expect(mockApplyWorkspaceSubscriptionLifecycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_1',
        nextPlan: 'pro',
        nextStatus: 'active'
      })
    );
    expect(mockUpsertBillingProfile).toHaveBeenCalledWith(
      'user_1',
      expect.objectContaining({
        tier: 'premium',
        status: 'active',
        paddle_subscription_id: 'sub_1'
      })
    );
  });

  it('downgrades workspace to free on past_due', async () => {
    const result = await handlePaddleWebhookEvent({
      event_id: 'evt_2',
      event_type: 'subscription.past_due',
      data: {
        id: 'sub_1',
        customer_id: 'cus_1',
        status: 'past_due',
        custom_data: {
          uid: 'user_1'
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(mockApplyWorkspaceSubscriptionLifecycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPlan: 'free',
        nextStatus: 'past_due'
      })
    );
    expect(mockUpsertBillingProfile).toHaveBeenCalledWith(
      'user_1',
      expect.objectContaining({
        tier: 'free',
        status: 'past_due'
      })
    );
  });

  it('acknowledges safely when workspace cannot be resolved', async () => {
    mockResolveWorkspaceForWebhook.mockResolvedValue(null);

    const result = await handlePaddleWebhookEvent({
      event_id: 'evt_3',
      event_type: 'subscription.updated',
      data: {
        id: 'sub_missing',
        customer_id: 'cus_missing',
        status: 'active',
        custom_data: {}
      }
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('acknowledged');
    expect(mockApplyWorkspaceSubscriptionLifecycleUpdate).not.toHaveBeenCalled();
    expect(mockUpsertBillingProfile).not.toHaveBeenCalled();
  });
});
