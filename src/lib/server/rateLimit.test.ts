import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DAILY_QUERY_LIMIT, todayUtc } from './rateLimit';

// ─── todayUtc ──────────────────────────────────────────────────────────────

describe('todayUtc', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayUtc();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the current UTC date', () => {
    const expected = new Date().toISOString().slice(0, 10);
    expect(todayUtc()).toBe(expected);
  });
});

// ─── DAILY_QUERY_LIMIT ─────────────────────────────────────────────────────

describe('DAILY_QUERY_LIMIT', () => {
  it('is set to 20', () => {
    expect(DAILY_QUERY_LIMIT).toBe(20);
  });
});

// ─── checkRateLimit (mocked Firestore) ────────────────────────────────────

describe('checkRateLimit', () => {
  const today = new Date().toISOString().slice(0, 10);

  // We mock the firebase-admin module so tests don't need a real GCP connection.
  // Each test overrides adminDb.runTransaction to simulate different Firestore states.
  vi.mock('./firebase-admin', () => {
    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      runTransaction: vi.fn(),
    };
    return { adminDb: mockDb, adminAuth: {} };
  });

  // Also mock FieldValue so the import doesn't break
  vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
      increment: (n: number) => ({ _increment: n }),
    },
  }));

  beforeEach(() => {
    vi.resetModules();
  });

  it('allows a request when count is below the limit', async () => {
    const { adminDb } = await import('./firebase-admin');
    (adminDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ data: () => ({ date: today, count: 5 }) }),
          update: vi.fn(),
          set: vi.fn(),
        };
        return fn(tx);
      }
    );

    const { checkRateLimit } = await import('./rateLimit');
    const result = await checkRateLimit('uid-123');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(DAILY_QUERY_LIMIT - 5 - 1);
  });

  it('blocks a request when count equals the limit', async () => {
    const { adminDb } = await import('./firebase-admin');
    (adminDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ data: () => ({ date: today, count: DAILY_QUERY_LIMIT }) }),
          update: vi.fn(),
          set: vi.fn(),
        };
        return fn(tx);
      }
    );

    const { checkRateLimit } = await import('./rateLimit');
    const result = await checkRateLimit('uid-123');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets the counter when the stored date is yesterday', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { adminDb } = await import('./firebase-admin');
    const mockSet = vi.fn();
    (adminDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: vi.fn().mockResolvedValue({
            data: () => ({ date: yesterday, count: DAILY_QUERY_LIMIT }), // was at limit yesterday
          }),
          update: vi.fn(),
          set: mockSet,
        };
        return fn(tx);
      }
    );

    const { checkRateLimit } = await import('./rateLimit');
    const result = await checkRateLimit('uid-123');

    // Should be allowed (yesterday's limit doesn't count)
    expect(result.allowed).toBe(true);
    // Should have called tx.set to reset the date
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), { date: today, count: 1 });
  });

  it('allows the last request before the limit (count = limit - 1)', async () => {
    const { adminDb } = await import('./firebase-admin');
    (adminDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: vi.fn().mockResolvedValue({
            data: () => ({ date: today, count: DAILY_QUERY_LIMIT - 1 }),
          }),
          update: vi.fn(),
          set: vi.fn(),
        };
        return fn(tx);
      }
    );

    const { checkRateLimit } = await import('./rateLimit');
    const result = await checkRateLimit('uid-123');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0); // this was the last one
  });

  it('handles a brand-new user (no doc exists)', async () => {
    const { adminDb } = await import('./firebase-admin');
    const mockSet = vi.fn();
    (adminDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ data: () => undefined }),
          update: vi.fn(),
          set: mockSet,
        };
        return fn(tx);
      }
    );

    const { checkRateLimit } = await import('./rateLimit');
    const result = await checkRateLimit('new-user');
    expect(result.allowed).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), { date: today, count: 1 });
  });
});
