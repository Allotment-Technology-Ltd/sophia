import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceDocs = new Map<string, Record<string, unknown>>();

function makeWorkspaceSnapshot(id: string, data: Record<string, unknown> | undefined) {
  return {
    id,
    exists: Boolean(data),
    data: () => data ?? {}
  };
}

vi.mock('$lib/server/sophiaDocumentsDb', () => ({
  sophiaDocumentsDb: {
    collection: (name: string) => {
      if (name !== 'billingWorkspaces') {
        return {
          doc: () => ({
            get: async () => ({ exists: false, data: () => ({}) }),
            set: async () => undefined
          })
        };
      }
      return {
        doc: (id: string) => ({
          get: async () => makeWorkspaceSnapshot(id, workspaceDocs.get(id)),
          set: async (data: Record<string, unknown>) => {
            const current = workspaceDocs.get(id) ?? {};
            workspaceDocs.set(id, { ...current, ...data });
          }
        }),
        where: (field: string, _op: '==', value: string) => ({
          limit: () => ({
            get: async () => {
              for (const [id, doc] of workspaceDocs.entries()) {
                if (doc[field] === value) {
                  return { empty: false, docs: [makeWorkspaceSnapshot(id, doc)] };
                }
              }
              return { empty: true, docs: [] };
            }
          })
        })
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<unknown>) =>
      fn({
        get: async (ref: any) => ref.get(),
        set: async (ref: any, data: any, _options?: any) => ref.set(data)
      })
  }
}));

import {
  getOrCreateDefaultWorkspace,
  resolveWorkspaceForWebhook,
  applyWorkspaceSubscriptionLifecycleUpdate
} from './workspaces';

describe('billing workspace resolution', () => {
  beforeEach(() => {
    workspaceDocs.clear();
    workspaceDocs.set('ws_sub', {
      uid: 'user_sub',
      plan: 'pro',
      paddle_subscription_id: 'sub_1',
      paddle_customer_id: 'cus_x'
    });
    workspaceDocs.set('ws_customer', {
      uid: 'user_customer',
      plan: 'pro',
      paddle_subscription_id: null,
      paddle_customer_id: 'cus_1'
    });
    workspaceDocs.set('ws_custom', {
      uid: 'user_custom',
      plan: 'free'
    });
  });

  it('resolves subscription id before customer/custom data', async () => {
    const resolved = await resolveWorkspaceForWebhook({
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
      workspaceId: 'ws_custom',
      uid: 'user_fallback'
    });
    expect(resolved?.workspace.id).toBe('ws_sub');
    expect(resolved?.source).toBe('paddle_subscription_id');
  });

  it('resolves by customer id when subscription id not found', async () => {
    const resolved = await resolveWorkspaceForWebhook({
      subscriptionId: 'sub_unknown',
      customerId: 'cus_1',
      workspaceId: 'ws_custom'
    });
    expect(resolved?.workspace.id).toBe('ws_customer');
    expect(resolved?.source).toBe('paddle_customer_id');
  });

  it('falls back to workspaceId from custom data', async () => {
    const resolved = await resolveWorkspaceForWebhook({
      subscriptionId: 'sub_unknown',
      customerId: 'cus_unknown',
      workspaceId: 'ws_custom'
    });
    expect(resolved?.workspace.id).toBe('ws_custom');
    expect(resolved?.source).toBe('custom_data.workspaceId');
  });

  it('falls back to uid default workspace creation', async () => {
    const resolved = await resolveWorkspaceForWebhook({
      subscriptionId: 'sub_unknown',
      customerId: 'cus_unknown',
      workspaceId: 'ws_unknown',
      uid: 'user_new'
    });
    expect(resolved?.workspace.id).toBe('default:user_new');
    expect(resolved?.source).toBe('custom_data.uid_default_workspace');
  });

  it('applies downgrade lifecycle atomically', async () => {
    workspaceDocs.set('ws_lifecycle', {
      uid: 'user_lifecycle',
      plan: 'pro',
      subscription_status: 'active',
      plan_updated_at: '2026-01-01T00:00:00.000Z'
    });

    const next = await applyWorkspaceSubscriptionLifecycleUpdate({
      workspaceId: 'ws_lifecycle',
      uid: 'user_lifecycle',
      nextPlan: 'free',
      nextStatus: 'canceled',
      paddleCustomerId: 'cus_life',
      paddleSubscriptionId: 'sub_life'
    });

    expect(next.plan).toBe('free');
    expect(next.subscription_status).toBe('canceled');
    expect(next.plan_ended_at).toBeTruthy();
    expect(next.plan_expires_at).toBeNull();
  });

  it('creates default workspace as free plan', async () => {
    const workspace = await getOrCreateDefaultWorkspace('user_seed');
    expect(workspace.id).toBe('default:user_seed');
    expect(workspace.plan).toBe('free');
  });
});
