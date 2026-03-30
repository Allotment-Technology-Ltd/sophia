import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifySignature, mockParseWebhook, mockHandleWebhook } = vi.hoisted(() => ({
  mockVerifySignature: vi.fn(),
  mockParseWebhook: vi.fn(),
  mockHandleWebhook: vi.fn()
}));

vi.mock('$lib/server/billing/flags', () => ({
  BILLING_FEATURE_ENABLED: true
}));

vi.mock('$lib/server/billing/paddle', () => ({
  verifyPaddleWebhookSignature: mockVerifySignature,
  parsePaddleWebhook: mockParseWebhook
}));

vi.mock('$lib/server/billing/webhook', () => ({
  handlePaddleWebhookEvent: mockHandleWebhook
}));

import { POST } from './+server';

describe('POST /api/billing/webhook signature checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySignature.mockReturnValue(true);
    mockParseWebhook.mockReturnValue({ event_id: 'evt_1', event_type: 'transaction.paid', data: {} });
    mockHandleWebhook.mockResolvedValue({ ok: true, message: 'processed' });
  });

  it('returns 401 when signature is invalid', async () => {
    mockVerifySignature.mockReturnValue(false);

    const request = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'paddle-signature': 'ts=1;h1=deadbeef'
      },
      body: JSON.stringify({ event_type: 'transaction.paid' })
    });

    const response = await POST({ request } as never);
    expect(response.status).toBe(401);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});
