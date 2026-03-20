import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/apiAuth', () => ({
  verifyApiKey: vi.fn(async () => ({ valid: true, key_id: 'k_test', owner_uid: 'user:owner' }))
}));

vi.mock('$lib/server/analytics', () => ({
  logServerAnalytics: vi.fn(async () => {})
}));

vi.mock('$lib/server/byok/store', () => ({
  loadByokProviderApiKeys: vi.fn(async () => ({ anthropic: 'sk-ant-test' }))
}));

vi.mock('$lib/server/byok/tenantIdentity', () => ({
  resolveByokOwnerUid: vi.fn(() => ({ ownerUid: 'user:owner' }))
}));

vi.mock('$lib/server/aaif/runtime', () => ({
  executeAAIFRequest: vi.fn(async () => ({
    output: 'OK',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    cost: 0.001,
    routing: {
      reason: 'Restormel selected the route.'
    }
  }))
}));

import { POST } from '../../../routes/api/beta/aaif/+server';

describe('/api/beta/aaif', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns AAIF JSON for a valid authenticated request', async () => {
    const response = await POST({
      request: new Request('http://localhost/api/beta/aaif', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req_aaif'
        },
        body: JSON.stringify({
          input: 'Reply with OK',
          task: 'chat',
          constraints: {
            latency: 'low',
            maxCost: 0.05
          }
        })
      })
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      output: 'OK',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      cost: 0.001,
      routing: {
        reason: 'Restormel selected the route.'
      }
    });
  });

  it('returns 400 for an invalid AAIF payload', async () => {
    const response = await POST({
      request: new Request('http://localhost/api/beta/aaif', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req_aaif_bad'
        },
        body: JSON.stringify({
          task: 'chat'
        })
      })
    } as never);

    expect(response.status).toBe(400);
  });
});
