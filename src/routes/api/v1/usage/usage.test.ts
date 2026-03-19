import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, mockLogServerAnalytics } = vi.hoisted(() => {
  const queryGet = vi.fn();

  const chain = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: queryGet
  } as any;

  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === 'api_keys') return chain;
    if (name === 'analytics') return { add: vi.fn().mockResolvedValue(undefined) };
    return chain;
  });

  return {
    mockDb: {
      collection,
      __queryGet: queryGet
    },
    mockLogServerAnalytics: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('$lib/server/firebase-admin', () => ({
  adminDb: mockDb
}));

vi.mock('$lib/server/authRoles', () => ({
  hasAdministratorRole: vi.fn((user: { role?: string | null }) => user?.role === 'administrator')
}));

vi.mock('$lib/server/analytics', () => ({
  logServerAnalytics: mockLogServerAnalytics
}));

describe('/api/v1/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: null },
      url: new URL('http://localhost/api/v1/usage')
    } as any);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.title).toBe('Authentication required');
  });

  it('blocks non-admin from reading another owner usage', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user-1', email: null, displayName: null, photoURL: null, role: 'user', roles: ['user'] } },
      url: new URL('http://localhost/api/v1/usage?owner_uid=user-2')
    } as any);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.title).toBe('Forbidden');
  });

  it('aggregates usage totals for owner', async () => {
    mockDb.__queryGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'key_1',
          data: () => ({
            name: 'Primary',
            key_prefix: 'sk-sophia-abc',
            active: true,
            usage_count: 10,
            daily_count: 3,
            rate_limit: { daily_quota: 100 },
            daily_reset_at: null,
            created_at: null,
            last_used_at: null
          })
        },
        {
          id: 'key_2',
          data: () => ({
            name: 'Secondary',
            key_prefix: 'sk-sophia-def',
            active: false,
            usage_count: 6,
            daily_count: 1,
            rate_limit: { daily_quota: 50 },
            daily_reset_at: null,
            created_at: null,
            last_used_at: null
          })
        }
      ]
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user-1', email: null, displayName: null, photoURL: null, role: 'user', roles: ['user'] } },
      url: new URL('http://localhost/api/v1/usage')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.owner_uid).toBe('user-1');
    expect(body.totals).toEqual({
      usage_count: 16,
      daily_count: 4,
      daily_quota: 150,
      active_keys: 1,
      total_keys: 2
    });
  });
});
