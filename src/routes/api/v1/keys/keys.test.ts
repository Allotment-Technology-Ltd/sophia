import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, mockLogServerAnalytics } = vi.hoisted(() => {
  const docGet = vi.fn();
  const docUpdate = vi.fn();
  const docSet = vi.fn();

  const queryGet = vi.fn();
  const queryWhere = vi.fn();
  const queryOrderBy = vi.fn();
  const queryLimit = vi.fn();

  const chain = {
    where: queryWhere,
    orderBy: queryOrderBy,
    limit: queryLimit,
    get: queryGet,
    doc: vi.fn()
  } as any;

  queryWhere.mockReturnValue(chain);
  queryOrderBy.mockReturnValue(chain);
  queryLimit.mockReturnValue(chain);

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === 'api_keys') {
      chain.doc.mockImplementation(() => ({
        set: docSet,
        get: docGet,
        update: docUpdate
      }));
      return chain;
    }

    if (name === 'analytics') {
      return {
        add: vi.fn().mockResolvedValue(undefined)
      };
    }

    return chain;
  });

  return {
    mockDb: {
      collection,
      __queryGet: queryGet,
      __docGet: docGet,
      __docUpdate: docUpdate,
      __docSet: docSet,
      __queryWhere: queryWhere
    },
    mockLogServerAnalytics: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('$lib/server/firebase-admin', () => ({
  adminDb: mockDb
}));

vi.mock('$lib/server/apiAuth', () => ({
  createApiKey: vi.fn(() => ({
    rawKey: 'sk-sophia-test',
    keyId: 'key_test',
    keyHash: 'hash_test',
    prefix: 'sk-sophia-test'
  }))
}));

vi.mock('$lib/server/authRoles', () => ({
  hasAdministratorRole: vi.fn((user: { role?: string | null }) => user?.role === 'administrator')
}));

vi.mock('$lib/server/analytics', () => ({
  logServerAnalytics: mockLogServerAnalytics
}));

describe('/api/v1/keys ownership controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-admin owner_uid overrides on list', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user-1', email: null, displayName: null, photoURL: null, role: 'user', roles: ['user'] } },
      url: new URL('http://localhost/api/v1/keys?owner_uid=user-2')
    } as any);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.title).toBe('Forbidden');
  });

  it('returns caller-owned keys for non-admin list', async () => {
    mockDb.__queryGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'key_1',
          data: () => ({
            owner_uid: 'user-1',
            name: 'Default key',
            key_prefix: 'sk-sophia-abc',
            active: true,
            created_at: { toDate: () => new Date('2026-03-09T12:00:00.000Z') },
            last_used_at: null,
            usage_count: 4,
            daily_count: 2,
            rate_limit: { daily_quota: 100 },
            daily_reset_at: null
          })
        }
      ]
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user-1', email: null, displayName: null, photoURL: null, role: 'user', roles: ['user'] } },
      url: new URL('http://localhost/api/v1/keys')
    } as any);

    expect(response.status).toBe(200);
    expect(mockDb.__queryWhere).toHaveBeenCalledWith('owner_uid', '==', 'user-1');
    const body = await response.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].owner_uid).toBe('user-1');
  });

  it('rejects non-admin owner override on create', async () => {
    const { POST } = await import('./+server');
    const response = await POST({
      locals: { user: { uid: 'user-1', email: null, displayName: null, photoURL: null, role: 'user', roles: ['user'] } },
      request: new Request('http://localhost/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_uid: 'user-2' })
      })
    } as any);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.title).toBe('Forbidden');
  });

  it('rejects revoke when key owner does not match non-admin', async () => {
    mockDb.__docGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ owner_uid: 'user-2' })
    });

    const { DELETE } = await import('./+server');
    const response = await DELETE({
      locals: { user: { uid: 'user-1', email: null, displayName: null, photoURL: null, role: 'user', roles: ['user'] } },
      url: new URL('http://localhost/api/v1/keys?key_id=key_1'),
      request: new Request('http://localhost/api/v1/keys?key_id=key_1', { method: 'DELETE' })
    } as any);

    expect(response.status).toBe(403);
    expect(mockDb.__docUpdate).not.toHaveBeenCalled();
  });
});
