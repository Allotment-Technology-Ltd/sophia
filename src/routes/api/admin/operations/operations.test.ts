import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssertAdminAccess, mockCreateAdminOperation, mockListAdminOperations } = vi.hoisted(() => ({
  mockAssertAdminAccess: vi.fn(() => ({ uid: 'admin-1', email: 'admin@example.com' })),
  mockCreateAdminOperation: vi.fn(),
  mockListAdminOperations: vi.fn()
}));

vi.mock('$lib/server/adminAccess', () => ({
  assertAdminAccess: mockAssertAdminAccess
}));

vi.mock('$lib/server/adminOperations', () => ({
  createAdminOperation: mockCreateAdminOperation,
  listAdminOperations: mockListAdminOperations
}));

describe('/api/admin/operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists operations for admins', async () => {
    mockListAdminOperations.mockResolvedValue([
      {
        id: 'op_1',
        kind: 'validate',
        status: 'queued'
      }
    ]);

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'admin-1', email: 'admin@example.com' } },
      url: new URL('http://localhost/api/admin/operations?limit=10')
    } as any);

    expect(response.status).toBe(200);
    expect(mockAssertAdminAccess).toHaveBeenCalled();
    expect(mockListAdminOperations).toHaveBeenCalledWith(10);
    const body = await response.json();
    expect(body.operations).toHaveLength(1);
  });

  it('creates an operation from JSON input', async () => {
    mockCreateAdminOperation.mockResolvedValue({
      id: 'op_2',
      kind: 'diagnose_doctor',
      status: 'queued',
      requested_action: 'Run Restormel doctor / diagnostics'
    });

    const { POST } = await import('./+server');
    const response = await POST({
      locals: { user: { uid: 'admin-1', email: 'admin@example.com' } },
      request: new Request('http://localhost/api/admin/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'diagnose_doctor',
          payload: { scope: 'full' }
        })
      })
    } as any);

    expect(response.status).toBe(201);
    expect(mockCreateAdminOperation).toHaveBeenCalledWith(
      { uid: 'admin-1', email: 'admin@example.com' },
      { kind: 'diagnose_doctor', payload: { scope: 'full' } }
    );
    const body = await response.json();
    expect(body.operation.id).toBe('op_2');
  });

  it('rejects malformed JSON bodies', async () => {
    const { POST } = await import('./+server');
    const response = await POST({
      locals: { user: { uid: 'admin-1', email: 'admin@example.com' } },
      request: new Request('http://localhost/api/admin/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json'
      })
    } as any);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});
