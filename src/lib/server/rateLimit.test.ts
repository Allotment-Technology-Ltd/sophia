import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DAILY_QUERY_LIMIT,
  PLATFORM_DAILY_BUDGET_CREDITS,
  resolvePlatformDeepSearchLimit,
  resolvePlatformPremiumSearchLimit,
  resolvePlatformStandardSearchLimit,
  todayUtc
} from './rateLimit';

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

describe('resolvePlatformStandardSearchLimit', () => {
  it('returns 5 for free users', () => {
    expect(resolvePlatformStandardSearchLimit('free')).toBe(5);
  });

  it('returns 10 for founder users', () => {
    expect(resolvePlatformStandardSearchLimit('founder')).toBe(10);
  });

  it('returns 10 for pro users', () => {
    expect(resolvePlatformStandardSearchLimit('pro')).toBe(10);
  });

  it('returns 20 for premium users', () => {
    expect(resolvePlatformStandardSearchLimit('premium')).toBe(20);
  });
});

describe('resolvePlatformDeepSearchLimit', () => {
  it('returns 0 for free users', () => {
    expect(resolvePlatformDeepSearchLimit('free')).toBe(0);
  });

  it('returns 3 for founder/pro/premium users', () => {
    expect(resolvePlatformDeepSearchLimit('founder')).toBe(3);
    expect(resolvePlatformDeepSearchLimit('pro')).toBe(3);
    expect(resolvePlatformDeepSearchLimit('premium')).toBe(3);
  });
});

describe('resolvePlatformPremiumSearchLimit', () => {
  it('returns 0 for free users', () => {
    expect(resolvePlatformPremiumSearchLimit('free')).toBe(0);
  });

  it('returns 1 for founder/pro/premium users', () => {
    expect(resolvePlatformPremiumSearchLimit('founder')).toBe(1);
    expect(resolvePlatformPremiumSearchLimit('pro')).toBe(1);
    expect(resolvePlatformPremiumSearchLimit('premium')).toBe(1);
  });
});

describe('consumePlatformBudget bypassQuota', () => {
  it('returns allowed without incrementing when bypassQuota is true', async () => {
    const { consumePlatformBudget } = await import('./rateLimit');
    const result = await consumePlatformBudget('owner-test-uid', {
      depthMode: 'standard',
      plan: 'free',
      bypassQuota: true
    });
    expect(result.allowed).toBe(true);
    expect(result.remainingCredits).toBe(PLATFORM_DAILY_BUDGET_CREDITS);
  });
});

// ─── checkRateLimit (mocked sophia_documents compat) ─────────────────────

describe('checkRateLimit', () => {
  const today = new Date().toISOString().slice(0, 10);

  // Mock `sophiaDocumentsDb` so tests don't need DATABASE_URL or a real DB.
  // Each test overrides sophiaDocumentsDb.runTransaction to simulate document state.
  vi.mock('./sophiaDocumentsDb', () => {
    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      runTransaction: vi.fn(),
    };
    return { sophiaDocumentsDb: mockDb };
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it('allows a request when count is below the limit', async () => {
    const { sophiaDocumentsDb } = await import('./sophiaDocumentsDb');
    (sophiaDocumentsDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
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
    const { sophiaDocumentsDb } = await import('./sophiaDocumentsDb');
    (sophiaDocumentsDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
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
    const { sophiaDocumentsDb } = await import('./sophiaDocumentsDb');
    const mockSet = vi.fn();
    (sophiaDocumentsDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
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
    const { sophiaDocumentsDb } = await import('./sophiaDocumentsDb');
    (sophiaDocumentsDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
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
    const { sophiaDocumentsDb } = await import('./sophiaDocumentsDb');
    const mockSet = vi.fn();
    (sophiaDocumentsDb.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
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
