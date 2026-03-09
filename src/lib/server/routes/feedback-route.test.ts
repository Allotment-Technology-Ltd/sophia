import { describe, expect, it, vi, beforeEach } from 'vitest';

const setMock = vi.fn(async () => undefined);
vi.mock('$lib/server/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            set: setMock
          }))
        }))
      }))
    }))
  }
}));

import { POST } from '../../../routes/api/feedback/+server';

describe('/api/feedback POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is missing', async () => {
    const request = new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId: 'run:1', passType: 'analysis', rating: 'up' })
    });

    const response = await POST({ request, locals: {} } as never);
    expect(response.status).toBe(401);
  });

  it('writes valid feedback', async () => {
    const request = new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId: 'run:1', passType: 'synthesis', rating: 'down' })
    });

    const response = await POST({ request, locals: { user: { uid: 'u1' } } } as never);
    expect(response.status).toBe(200);
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});
